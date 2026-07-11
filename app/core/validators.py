"""
Reusable validators for Pydantic schemas.
"""

import re
from urllib.parse import urlparse


def validate_password_strength(password: str) -> str:
    """
    Validate password complexity requirements.

    Rules:
    - Minimum 8 characters (enforced by Field, but double-check here)
    - At least one uppercase letter
    - At least one lowercase letter
    - At least one digit
    - At least one special character

    Args:
        password: The password to validate

    Returns:
        The password if valid

    Raises:
        ValueError: If password doesn't meet requirements
    """
    if len(password) < 8:
        raise ValueError("Senha deve ter no mínimo 8 caracteres")

    if not re.search(r"[A-Z]", password):
        raise ValueError("Senha deve conter pelo menos uma letra maiúscula")

    if not re.search(r"[a-z]", password):
        raise ValueError("Senha deve conter pelo menos uma letra minúscula")

    if not re.search(r"\d", password):
        raise ValueError("Senha deve conter pelo menos um número")

    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?`~]", password):
        raise ValueError("Senha deve conter pelo menos um caractere especial (!@#$%^&*...)")

    return password


# Pattern to detect common XSS payloads in text fields
_XSS_PATTERNS = re.compile(
    r"<\s*script|javascript\s*:|on\w+\s*=|<\s*iframe|<\s*object|<\s*embed|<\s*link|<\s*svg\s+on",
    re.IGNORECASE,
)


def sanitize_text(value: str) -> str:
    """
    Sanitize a text field by stripping dangerous HTML/script patterns.

    Does NOT strip all HTML (descriptions may legitimately contain < or >),
    but rejects values that look like injection attempts.

    Raises:
        ValueError: If the value contains suspicious script/event patterns.
    """
    if _XSS_PATTERNS.search(value):
        raise ValueError("Texto contém conteúdo potencialmente perigoso (scripts, iframes, etc.)")
    return value


def validate_photo_url(url: str) -> str:
    """
    Validate that a photo URL has a safe scheme and does not contain injection.

    Raises:
        ValueError: If the URL is not http/https or contains suspicious patterns.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL de foto com protocolo inválido: {parsed.scheme}")
    if _XSS_PATTERNS.search(url):
        raise ValueError("URL de foto contém conteúdo potencialmente perigoso")
    return url


def validate_photo_list(photos: list[str]) -> list[str]:
    """Validate a list of photo URLs."""
    return [validate_photo_url(url) for url in photos]


# ─── Placa / Chassi ───────────────────────────────────────────────────────────
# Placa brasileira (cobre Mercosul ABC1D23 e antiga ABC1234) — 7 caracteres
PLATE_REGEX = r"^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$"
# Chassi gravado no vidro (padrão CONTRAN: últimos 8 caracteres do chassi).
# Exatamente 8 alfanuméricos, com pelo menos 1 letra E 1 dígito.
CHASSI_VIDRO_REGEX = r"^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{8}$"

PLATE_ERROR_MESSAGE = (
    "Formato inválido. Use placa (ABC1234 / ABC1D23) ou "
    "chassi do vidro (8 caracteres com letras e números)."
)


def normalize_plate(v: str) -> str:
    """Normaliza para maiúsculas e remove tudo que não seja A-Z ou 0-9."""
    return re.sub(r"[^A-Z0-9]", "", v.upper())


def is_valid_plate_or_chassi(v: str) -> bool:
    """Indica se o valor é uma placa ou chassi do vidro válido (normaliza antes)."""
    value = normalize_plate(v)
    return bool(re.match(PLATE_REGEX, value) or re.match(CHASSI_VIDRO_REGEX, value))


def validate_vehicle_plate(v: str) -> str:
    """Normaliza e valida placa/chassi. Retorna o valor normalizado ou levanta ValueError."""
    value = normalize_plate(v)
    if re.match(PLATE_REGEX, value) or re.match(CHASSI_VIDRO_REGEX, value):
        return value
    raise ValueError(PLATE_ERROR_MESSAGE)


# ─── Tonalidade de película ───────────────────────────────────────────────────
# Padrão G + dígitos (G05, G20, G35...) é armazenado em maiúsculas; outros
# valores (ex.: "Incolor") apenas têm espaços das bordas removidos.
_G_TONALITY_REGEX = re.compile(r"^[Gg]\d{1,3}$")


def normalize_tonality(v: str | None) -> str | None:
    """Normaliza tonalidade: trim sempre; upper para o padrão G##. Vazio vira None."""
    if v is None:
        return None
    value = v.strip()
    if not value:
        return None
    if _G_TONALITY_REGEX.match(value):
        return value.upper()
    return value
