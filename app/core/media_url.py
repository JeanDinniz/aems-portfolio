"""Validação de URLs de mídia (🟠 auditoria).

Aceita apenas URLs que apontem para o storage do próprio sistema (upload interno),
evitando que um cliente grave URL arbitrária (host externo / intranet) em campos
persistidos e servidos em contexto de confiança (biblioteca, certificados, ponto).

A validação é feita por **host** (allowlist derivada dos settings), não por
substring: uma URL externa que apenas contenha "/uploads/" no path
(ex.: `http://evil.com/uploads/x.jpg`) é rejeitada.

Hosts aceitos:
- host de `BASE_URL` (uploads locais servidos pela própria API);
- host de `S3_PUBLIC_URL` e `S3_ENDPOINT`, quando definidos (MinIO/S3);
- `{S3_BUCKET}.s3.amazonaws.com` (fallback AWS virtual-hosted).

URLs relativas (sem host) são aceitas apenas quando o path aponta para o storage
interno (`/uploads/` ou `/{S3_BUCKET}/`) — same-origin, não há host externo.
"""

from posixpath import normpath
from urllib.parse import urlparse

from app.config import get_settings
from app.core.exceptions import ValidationError

_ALLOWED_SCHEMES = {"http", "https"}


def _allowed_hosts() -> set[str]:
    """Conjunto de hosts (lowercase, com porta quando houver) do storage próprio."""
    settings = get_settings()
    hosts: set[str] = set()
    for candidate in (settings.BASE_URL, settings.S3_PUBLIC_URL, settings.S3_ENDPOINT):
        if not candidate:
            continue
        netloc = urlparse(candidate).netloc.lower()
        if netloc:
            hosts.add(netloc)
    # Fallback AWS virtual-hosted (ver _upload_to_s3 em upload/router.py)
    if settings.S3_BUCKET:
        hosts.add(f"{settings.S3_BUCKET.lower()}.s3.amazonaws.com")
    return hosts


def validate_internal_media_url(url: str | None, *, field: str = "URL de mídia") -> None:
    """Levanta ValidationError se `url` não vier do upload do próprio sistema.

    `None`/vazio é aceito (campo opcional — a obrigatoriedade fica no schema).
    """
    if not url:
        return

    settings = get_settings()
    parsed = urlparse(url)
    netloc = parsed.netloc.lower()

    if not netloc:
        # URL relativa/same-origin: só aceita se o path, JÁ NORMALIZADO, ficar
        # contido no storage interno. Normalizar rejeita traversal
        # (`/uploads/../../etc/passwd`), que apenas o prefixo deixaria passar.
        normalized = normpath(parsed.path)
        allowed_prefixes = ("/uploads/", f"/{settings.S3_BUCKET}/")
        if any(
            normalized == prefix.rstrip("/") or normalized.startswith(prefix)
            for prefix in allowed_prefixes
        ):
            return
        raise ValidationError(detail=f"{field} inválida: use o upload do próprio sistema")

    if parsed.scheme not in _ALLOWED_SCHEMES or netloc not in _allowed_hosts():
        raise ValidationError(detail=f"{field} inválida: use o upload do próprio sistema")
