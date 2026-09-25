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

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps

from app.config import get_settings
from app.core.security import decode_token, get_current_user

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

# --- Documentos da Biblioteca (PDF / apresentações / office) ---
# Extensão → content-type usado ao servir (browsers mandam content-types
# inconsistentes para office; a validação real é por extensão + magic bytes).
DOC_EXTENSION_TYPES = {
    "pdf": "application/pdf",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

# Magic bytes por família de formato de documento.
_DOC_MAGIC = {
    "pdf": (b"%PDF-",),  # PDF
    "zip": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),  # docx/xlsx/pptx (OOXML = zip)
    "ole2": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),  # doc/xls/ppt antigos (OLE2)
}

MAX_DOC_SIZE_MB = 50
MAX_DOC_SIZE_BYTES = MAX_DOC_SIZE_MB * 1024 * 1024

# --- Vídeos da vistoria (1 por O.S., anexo opcional) ---
ALLOWED_VIDEO_CONTENT_TYPES = {"video/mp4", "video/quicktime"}
ALLOWED_VIDEO_EXTENSIONS = {"mp4", "mov"}
MAX_VIDEO_SIZE_MB = 50
MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024


def _validate_video_magic(content: bytes) -> bool:
    """MP4 e MOV são contêineres ISO-BMFF: têm o box 'ftyp' logo no início
    (offset 4). Content-Type/extensão podem ser forjados; isto confere o miolo."""
    return b"ftyp" in content[4:16]


def _validate_doc_magic(content: bytes, extension: str) -> bool:
    """Confere se o conteúdo bate com a família esperada da extensão."""
    if extension == "pdf":
        return content.startswith(_DOC_MAGIC["pdf"])
    if extension in ("pptx", "docx", "xlsx"):
        return content.startswith(_DOC_MAGIC["zip"])
    if extension in ("ppt", "doc", "xls"):
        return content.startswith(_DOC_MAGIC["ole2"])
    return False


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


def build_s3_client():
    """Cria um cliente boto3 S3/MinIO a partir das settings (ou None em modo local).

    Reutilizável: passe o mesmo cliente para várias chamadas de ``read_media_bytes``
    (ex.: ZIP de fotos) em vez de recriar um cliente por foto.
    """
    if not settings.S3_ACCESS_KEY:
        return None
    import boto3  # type: ignore[import]

    kwargs: dict = {
        "aws_access_key_id": settings.S3_ACCESS_KEY,
        "aws_secret_access_key": settings.S3_SECRET_KEY,
    }
    if settings.S3_ENDPOINT:
        kwargs["endpoint_url"] = settings.S3_ENDPOINT
    return boto3.client("s3", **kwargs)


def read_media_bytes(url: str, s3_client=None) -> bytes | None:
    """
    Lê os bytes de uma foto a partir da sua URL pública, agnóstico ao storage.

    - S3/MinIO (settings.S3_ACCESS_KEY): extrai a key após "/{S3_BUCKET}/" e usa
      boto3 get_object.
    - Filesystem (dev): extrai o nome após "/uploads/" e lê de LOCAL_UPLOADS_DIR.

    Best-effort: retorna None em qualquer falha (foto ausente, URL inesperada,
    erro de I/O) — o chamador (ex.: export de fotos em ZIP) apenas pula a foto,
    nunca aborta por causa de uma imagem.

    I/O SÍNCRONO (boto3 / disco): chamar dentro de run_in_threadpool quando
    invocado a partir de um endpoint async.
    """
    if not url:
        return None

    try:
        if settings.S3_ACCESS_KEY:
            marker = f"/{settings.S3_BUCKET}/"
            idx = url.find(marker)
            if idx == -1:
                logger.warning("URL de mídia sem bucket esperado: %s", url)
                return None
            key = url[idx + len(marker) :].split("?", 1)[0]

            # Reutiliza o cliente passado (ZIP de fotos) ou cria um pontual.
            client = s3_client if s3_client is not None else build_s3_client()
            obj = client.get_object(Bucket=settings.S3_BUCKET, Key=key)
            return obj["Body"].read()

        marker = "/uploads/"
        idx = url.find(marker)
        if idx == -1:
            logger.warning("URL de mídia local sem /uploads/: %s", url)
            return None
        filename = url[idx + len(marker) :].split("?", 1)[0]
        # Defesa em profundidade contra path traversal: resolve o caminho e exige
        # que fique contido em LOCAL_UPLOADS_DIR (ex.: "/uploads/../../etc/passwd"
        # já é barrado no validador, mas o leitor não confia na URL de entrada).
        base = LOCAL_UPLOADS_DIR.resolve()
        file_path = (LOCAL_UPLOADS_DIR / filename).resolve()
        if not file_path.is_relative_to(base) or not file_path.is_file():
            return None
        return file_path.read_bytes()
    except Exception as exc:  # noqa: BLE001 — best-effort, foto ausente não quebra o export
        logger.warning("Falha ao ler mídia %s: %s", url, exc)
        return None


@router.post("/photo", summary="Upload de foto")
async def upload_photo(
    request: Request,
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

    # Rejeição rápida pelo Content-Length ANTES de ler qualquer byte
    # (o header cobre o multipart inteiro, então é um teto conservador)
    content_length = request.headers.get("content-length")
    if (
        content_length
        and content_length.isdigit()
        and int(content_length) > MAX_FILE_SIZE_BYTES * 2
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Arquivo muito grande. Tamanho maximo: {MAX_FILE_SIZE_MB} MB",
        )

    # Leitura em chunks com teto: nunca materializa mais que o limite em RAM
    # (Content-Length pode mentir ou faltar; worker único com 256 MB — ALTO da auditoria)
    chunks = bytearray()
    while chunk := await file.read(1024 * 1024):
        chunks.extend(chunk)
        if len(chunks) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Arquivo muito grande. Tamanho maximo: {MAX_FILE_SIZE_MB} MB",
            )
    content = bytes(chunks)

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


@router.post("/document", summary="Upload de documento (biblioteca)")
async def upload_document(
    request: Request,
    file: UploadFile,
    current_user=Depends(get_current_user),
) -> JSONResponse:
    """
    Faz upload de um documento da biblioteca.

    - Aceita multipart/form-data com campo 'file'
    - Tipos aceitos: PDF, PPT/PPTX, DOC/DOCX, XLS/XLSX
    - Tamanho máximo: 50 MB
    - Storage: S3/MinIO se configurado, senão uploads/ (modo dev)

    Returns:
        { "url": str, "file_name": str, "file_type": str, "file_size": int }
    """
    # Valida e normaliza a extensão (fonte da verdade para o tipo)
    original_name = file.filename or "documento"
    extension = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    if extension not in DOC_EXTENSION_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Extensão de arquivo não permitida: .{extension}. "
                f"Extensões aceitas: {', '.join(sorted(DOC_EXTENSION_TYPES))}"
            ),
        )

    # Rejeição rápida pelo Content-Length antes de ler bytes
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_DOC_SIZE_BYTES * 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Arquivo muito grande. Tamanho máximo: {MAX_DOC_SIZE_MB} MB",
        )

    # Leitura em chunks com teto (Content-Length pode mentir ou faltar)
    chunks = bytearray()
    while chunk := await file.read(1024 * 1024):
        chunks.extend(chunk)
        if len(chunks) > MAX_DOC_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Arquivo muito grande. Tamanho máximo: {MAX_DOC_SIZE_MB} MB",
            )
    content = bytes(chunks)

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Arquivo vazio",
        )

    # Valida magic bytes (Content-Type de office é pouco confiável)
    if not _validate_doc_magic(content, extension):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Conteúdo do arquivo não corresponde à extensão. Arquivo possivelmente corrompido.",
        )

    content_type = DOC_EXTENSION_TYPES[extension]
    file_id = uuid.uuid4().hex
    stored_filename = f"documents/{file_id}.{extension}"

    if settings.S3_ACCESS_KEY:
        url = await _upload_to_s3(content, stored_filename, content_type)
    else:
        url = await _save_locally(content, stored_filename.replace("/", "_"))

    return JSONResponse(
        content={
            "url": url,
            "file_name": original_name,
            "file_type": extension,
            "file_size": len(content),
        },
        status_code=status.HTTP_200_OK,
    )


@router.post("/video", summary="Upload de vídeo da vistoria")
async def upload_video(
    request: Request,
    file: UploadFile,
    current_user=Depends(get_current_user),
) -> JSONResponse:
    """
    Faz upload de um vídeo curto da vistoria (1 por O.S., opcional).

    - Tipos aceitos: MP4 (video/mp4), MOV (video/quicktime)
    - Tamanho máximo: 50 MB
    - Storage: S3/MinIO se configurado, senão uploads/ (modo dev)

    Returns: { "url": str }
    """
    if file.content_type not in ALLOWED_VIDEO_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Tipo de arquivo não suportado: {file.content_type}. "
                f"Tipos aceitos: {', '.join(sorted(ALLOWED_VIDEO_CONTENT_TYPES))}"
            ),
        )

    original_name = file.filename or "video.mp4"
    extension = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Extensão de arquivo não permitida: .{extension}. "
                f"Extensões aceitas: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}"
            ),
        )

    # Rejeição rápida pelo Content-Length antes de ler bytes
    content_length = request.headers.get("content-length")
    if (
        content_length
        and content_length.isdigit()
        and int(content_length) > MAX_VIDEO_SIZE_BYTES * 2
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Arquivo muito grande. Tamanho máximo: {MAX_VIDEO_SIZE_MB} MB",
        )

    # Leitura em chunks com teto real (Content-Length pode mentir ou faltar)
    chunks = bytearray()
    while chunk := await file.read(1024 * 1024):
        chunks.extend(chunk)
        if len(chunks) > MAX_VIDEO_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Arquivo muito grande. Tamanho máximo: {MAX_VIDEO_SIZE_MB} MB",
            )
    content = bytes(chunks)

    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Arquivo vazio",
        )

    if not _validate_video_magic(content):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Conteúdo do arquivo não corresponde a um vídeo. Arquivo possivelmente corrompido.",
        )

    file_id = uuid.uuid4().hex
    stored_filename = f"videos/{file_id}.{extension}"

    if settings.S3_ACCESS_KEY:
        url = await _upload_to_s3(content, stored_filename, file.content_type)
    else:
        url = await _save_locally(content, stored_filename.replace("/", "_"))

    return JSONResponse(content={"url": url}, status_code=status.HTTP_200_OK)


@router.get("/media-auth", include_in_schema=False, summary="Autorização de mídia (Nginx)")
async def media_auth(request: Request) -> Response:
    """
    Endpoint interno consultado pelo Nginx (auth_request) antes de servir
    qualquer arquivo de /uploads/ — fecha o acesso público às fotos (ALTO-2
    da auditoria).

    Aceita:
    - Cookie httpOnly `aems_media` (web — emitido no login/refresh), ou
    - Header Authorization: Bearer <access_token> (app mobile).

    Validação SÓ criptográfica (assinatura + expiração, sem banco/Redis):
    cada imagem da tela gera um subrequest — não pode custar uma query cada.
    """
    token = request.cookies.get("aems_media")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação necessária para acessar mídia",
        )

    try:
        payload = decode_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de mídia inválido ou expirado",
        ) from exc

    if payload.get("type") not in ("media", "access"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tipo de token não autorizado para mídia",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)
