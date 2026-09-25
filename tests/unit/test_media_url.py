"""Testes do validador de URL de mídia interna (app/core/media_url.py).

Foco: a validação deve ser por HOST (allowlist), não por substring — uma URL
externa que apenas contenha "/uploads/" no path NÃO pode ser aceita.
"""

from types import SimpleNamespace

import pytest

from app.core import media_url
from app.core.exceptions import ValidationError


def _fake_settings(**overrides):
    base = {
        "BASE_URL": "http://localhost:8000",
        "S3_BUCKET": "aems-files",
        "S3_PUBLIC_URL": None,
        "S3_ENDPOINT": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture(autouse=True)
def _patch_settings(monkeypatch):
    """Por padrão usa os defaults locais; cada teste pode re-patchar."""

    def _apply(**overrides):
        monkeypatch.setattr(media_url, "get_settings", lambda: _fake_settings(**overrides))

    _apply()
    return _apply


# --- Casos que DEVEM passar (URLs internas legítimas) ---


def test_accepts_none():
    media_url.validate_internal_media_url(None)


def test_accepts_empty_string():
    media_url.validate_internal_media_url("")


def test_accepts_local_upload_url():
    media_url.validate_internal_media_url("http://localhost:8000/uploads/abc.jpg")


def test_accepts_relative_upload_path():
    media_url.validate_internal_media_url("/uploads/abc.jpg")


def test_accepts_aws_bucket_host():
    media_url.validate_internal_media_url("https://aems-files.s3.amazonaws.com/abc.jpg")


def test_accepts_s3_public_url_host(_patch_settings):
    _patch_settings(S3_PUBLIC_URL="https://cdn.example.com")
    media_url.validate_internal_media_url("https://cdn.example.com/aems-files/abc.jpg")


def test_accepts_s3_endpoint_host(_patch_settings):
    _patch_settings(S3_ENDPOINT="http://minio:9000")
    media_url.validate_internal_media_url("http://minio:9000/aems-files/abc.jpg")


# --- Casos que DEVEM ser rejeitados (o furo do substring matching) ---


def test_rejects_external_host_with_uploads_path():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("http://evil.com/uploads/x.jpg")


def test_rejects_external_host_with_bucket_path():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("http://evil.com/aems-files/x.jpg")


def test_rejects_subdomain_confusable_host():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("http://localhost:8000.evil.com/uploads/x.jpg")


def test_rejects_s3_public_confusable_host(_patch_settings):
    _patch_settings(S3_PUBLIC_URL="https://cdn.example.com")
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("https://cdn.example.com.evil.com/aems-files/x.jpg")


def test_rejects_relative_path_outside_uploads():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("/etc/passwd")


def test_rejects_relative_uploads_traversal():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("/uploads/../../etc/passwd")


def test_rejects_relative_bucket_traversal():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("/aems-files/../secret.env")


def test_rejects_data_scheme():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("data:text/html,<script>alert(1)</script>")


def test_rejects_plain_external_url():
    with pytest.raises(ValidationError):
        media_url.validate_internal_media_url("https://evil.com/photo.jpg")


def test_error_uses_field_name():
    with pytest.raises(ValidationError) as exc:
        media_url.validate_internal_media_url("https://evil.com/x.jpg", field="Foto do certificado")
    assert "Foto do certificado" in str(exc.value.detail)
