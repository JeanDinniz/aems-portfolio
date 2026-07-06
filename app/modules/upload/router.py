"""
Upload router - API endpoint for photo uploads.

Behavior:
- If S3_ACCESS_KEY is configured: uploads to MinIO/S3
- Otherwise: saves to local uploads/ directory (dev mode)
"""

import json
import logging
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps

from app.config import get_settings
from app.core.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["Upload"])

settings = get_settings()

# Allowed content types for photos
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "heic", "heif"}

# Magic bytes for image file validation (Content-Type can be spoofed)
_MAGIC_BYTES = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"RIFF": "image/webp",  # WebP starts with RIFF....WEBP
}

MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Thumbnail (miniatura) — gerado no upload e servido nas grades/listas para
# evitar baixar a imagem cheia (~1-2 MB) só para exibir um quadradinho.
THUMBNAIL_MAX_DIMENSION = 320
THUMBNAIL_QUALITY = 80

# Cache agressivo: o nome do arquivo é um UUID e nunca é sobrescrito (imutável).
IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable"


def _validate_magic_bytes(content: bytes, declared_type: str) -> bool:
    """Validate file content matches declared content type via magic bytes."""
    # HEIC/HEIF uses ftyp box - check for it
    if declared_type in ("image/heic", "image/heif"):
        return b"ftyp" in content[:12]
    # WebP: starts with RIFF and contains WEBP at offset 8
    if declared_type == "image/webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    # JPEG/PNG: check known magic bytes
    for magic, mime_type in _MAGIC_BYTES.items():
        if content.startswith(magic):
            if declared_type in (mime_type, "image/jpg") and mime_type == "image/jpeg":
                return True
            if declared_type == mime_type:
                return True
    return False


# Local upload directory (dev mode fallback)
LOCAL_UPLOADS_DIR = Path("uploads")

# Flag para garantir política pública do bucket apenas uma vez por processo
_bucket_policy_applied = False


def _get_local_url(filename: str) -> str:
    """Returns an absolute URL for a locally stored file."""
    return f"{settings.BASE_URL}/uploads/{filename}"


def _generate_thumbnail(content: bytes) -> bytes | None:
    """
    Gera uma miniatura JPEG (~320 px no maior lado) em memória.

    Best-effort: qualquer falha (formato não suportado como HEIC sem plugin,
    arquivo corrompido) retorna None — o upload da foto original NUNCA é
    interrompido por causa do thumbnail.
    """
    try:
        with Image.open(BytesIO(content)) as img:
            img = ImageOps.exif_transpose(img)  # respeita a orientação EXIF
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.thumbnail((THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION))
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=THUMBNAIL_QUALITY, optimize=True)
            return buffer.getvalue()
    except Exception as exc:  # noqa: BLE001 — thumbnail é opcional, não pode quebrar o upload
        logger.warning("Falha ao gerar thumbnail: %s", exc)
        return None


async def _upload_to_s3(file_content: bytes, filename: str, content_type: str) -> str:
    """
    Uploads file to S3/MinIO.

    Returns:
        Public URL of the uploaded file
    """
    try:
        import boto3  # type: ignore[import]
        from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import]
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="boto3 nao instalado. Instale com: pip install boto3",
        ) from exc

    try:
        kwargs: dict = {
            "aws_access_key_id": settings.S3_ACCESS_KEY,
            "aws_secret_access_key": settings.S3_SECRET_KEY,
        }
        if settings.S3_ENDPOINT:
            kwargs["endpoint_url"] = settings.S3_ENDPOINT

        s3_client = boto3.client("s3", **kwargs)

        # Cria o bucket automaticamente se não existir (útil para MinIO em dev)
        try:
            s3_client.head_bucket(Bucket=settings.S3_BUCKET)
        except ClientError as bucket_err:
            error_code = bucket_err.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchBucket"):
                s3_client.create_bucket(Bucket=settings.S3_BUCKET)
            else:
                raise

        # Garante leitura pública no bucket uma vez por processo
        # Cobre casos onde o bucket já existia sem política pública
        global _bucket_policy_applied
        if not _bucket_policy_applied:
            public_policy = json.dumps(
                {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"AWS": "*"},
                            "Action": ["s3:GetObject"],
                            "Resource": [f"arn:aws:s3:::{settings.S3_BUCKET}/*"],
                        }
                    ],
                }
            )
            try:
                s3_client.put_bucket_policy(Bucket=settings.S3_BUCKET, Policy=public_policy)
                _bucket_policy_applied = True
            except (BotoCoreError, ClientError):
                pass

        s3_client.put_object(
            Bucket=settings.S3_BUCKET,
            Key=filename,
            Body=file_content,
            ContentType=content_type,
            CacheControl=IMAGE_CACHE_CONTROL,
        )

        public_base = settings.S3_PUBLIC_URL or settings.S3_ENDPOINT
        if public_base:
            url = f"{public_base}/{settings.S3_BUCKET}/{filename}"
        else:
            url = f"https://{settings.S3_BUCKET}.s3.amazonaws.com/{filename}"

        return url
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao fazer upload para S3: {exc}",
        ) from exc


async def _save_locally(file_content: bytes, filename: str) -> str:
    """
    Saves file to local uploads/ directory (dev fallback).

    Returns:
        Relative URL for the file
    """
    LOCAL_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    file_path = LOCAL_UPLOADS_DIR / filename

    with open(file_path, "wb") as f:
        f.write(file_content)

    return _get_local_url(filename)


@router.post("/photo", summary="Upload de foto")
async def upload_photo(
    file: UploadFile,
    current_user=Depends(get_current_user),
) -> JSONResponse:
    """
    Faz upload de uma foto.

    - Aceita multipart/form-data com campo 'file'
    - Tipos aceitos: JPEG, PNG, WebP, HEIC/HEIF
    - Tamanho maximo: 10 MB
    - Se S3_ACCESS_KEY configurado: salva no S3/MinIO
    - Caso contrario: salva localmente em uploads/ (modo dev)

    Returns:
        { "url": "string" }
    """
    # Validate content type
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Tipo de arquivo nao suportado: {file.content_type}. "
                f"Tipos aceitos: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
            ),
        )

    # Validate and sanitize file extension
    original_name = file.filename or "photo.jpg"
    extension = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Extensão de arquivo não permitida: .{extension}. "
                f"Extensões aceitas: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )

    # Read file content
    content = await file.read()

    # Validate file size
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Arquivo muito grande. Tamanho maximo: {MAX_FILE_SIZE_MB} MB",
        )

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Arquivo vazio",
        )

    # Validate magic bytes match declared content type
    if not _validate_magic_bytes(content, file.content_type):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Conteúdo do arquivo não corresponde ao tipo declarado. Arquivo possivelmente corrompido.",
        )

    # Generate unique filename (UUID prevents path traversal)
    file_id = uuid.uuid4().hex
    unique_filename = f"photos/{file_id}.{extension}"
    thumb_filename = f"photos/{file_id}_thumb.jpg"

    # Upload to S3 or save locally
    if settings.S3_ACCESS_KEY:
        url = await _upload_to_s3(content, unique_filename, file.content_type)
    else:
        url = await _save_locally(content, unique_filename.replace("/", "_"))

    # Thumbnail (best-effort): nunca interrompe o upload da foto original.
    # O front deriva a URL do thumb por convenção ({id}_thumb.jpg) e cai para a
    # original via onError caso o thumb não exista (fotos antigas).
    thumb_url = None
    thumb_bytes = _generate_thumbnail(content)
    if thumb_bytes is not None:
        try:
            if settings.S3_ACCESS_KEY:
                thumb_url = await _upload_to_s3(thumb_bytes, thumb_filename, "image/jpeg")
            else:
                thumb_url = await _save_locally(thumb_bytes, thumb_filename.replace("/", "_"))
        except Exception as exc:  # noqa: BLE001 — thumbnail é opcional
            logger.warning("Falha ao enviar thumbnail: %s", exc)
            thumb_url = None

    return JSONResponse(
        content={"url": url, "thumb_url": thumb_url}, status_code=status.HTTP_200_OK
    )
