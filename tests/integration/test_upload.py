"""
Integration tests for upload endpoint.
Tests photo upload with validations: content type, extension, size, magic bytes, local save.
"""

import io
import struct

import pytest
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Helper: create fake image content with correct magic bytes
# ---------------------------------------------------------------------------


def make_jpeg_bytes(size: int = 128) -> bytes:
    """Return minimal JPEG-like bytes (magic header + padding)."""
    header = b"\xff\xd8\xff\xe0"
    return header + b"\x00" * max(0, size - len(header))


def make_png_bytes(size: int = 128) -> bytes:
    """Return minimal PNG-like bytes (magic header + padding)."""
    header = b"\x89PNG\r\n\x1a\n"
    return header + b"\x00" * max(0, size - len(header))


def make_webp_bytes(size: int = 128) -> bytes:
    """Return minimal WebP-like bytes (RIFF....WEBP + padding)."""
    # RIFF<size>WEBP
    header = b"RIFF" + struct.pack("<I", size - 8) + b"WEBP"
    return header + b"\x00" * max(0, size - len(header))


def make_heic_bytes(size: int = 128) -> bytes:
    """Return minimal HEIC-like bytes with ftyp box."""
    # ftyp at offset 4
    header = b"\x00\x00\x00\x1cftyp" + b"heic"
    return header + b"\x00" * max(0, size - len(header))


# ===========================================================================
# Upload Photo endpoint tests
# ===========================================================================


class TestUploadPhoto:
    """Tests for POST /api/v1/upload/photo."""

    @pytest.mark.asyncio
    async def test_upload_jpeg_success(self, authenticated_client: AsyncClient):
        content = make_jpeg_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert "/uploads/" in data["url"]

    @pytest.mark.asyncio
    async def test_upload_png_success(self, authenticated_client: AsyncClient):
        content = make_png_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.png", io.BytesIO(content), "image/png")},
        )
        assert response.status_code == 200
        assert "url" in response.json()

    @pytest.mark.asyncio
    async def test_upload_webp_success(self, authenticated_client: AsyncClient):
        content = make_webp_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.webp", io.BytesIO(content), "image/webp")},
        )
        assert response.status_code == 200
        assert "url" in response.json()

    @pytest.mark.asyncio
    async def test_upload_heic_success(self, authenticated_client: AsyncClient):
        content = make_heic_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.heic", io.BytesIO(content), "image/heic")},
        )
        assert response.status_code == 200
        assert "url" in response.json()

    @pytest.mark.asyncio
    async def test_upload_heif_success(self, authenticated_client: AsyncClient):
        content = make_heic_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.heif", io.BytesIO(content), "image/heif")},
        )
        assert response.status_code == 200
        assert "url" in response.json()

    @pytest.mark.asyncio
    async def test_upload_jpg_content_type(self, authenticated_client: AsyncClient):
        """image/jpg should also be accepted (alias for jpeg)."""
        content = make_jpeg_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.jpeg", io.BytesIO(content), "image/jpg")},
        )
        assert response.status_code == 200


class TestUploadValidations:
    """Tests for upload validation logic."""

    @pytest.mark.asyncio
    async def test_reject_invalid_content_type(self, authenticated_client: AsyncClient):
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("doc.pdf", io.BytesIO(b"fake pdf"), "application/pdf")},
        )
        assert response.status_code == 422
        assert "nao suportado" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reject_invalid_extension(self, authenticated_client: AsyncClient):
        content = make_jpeg_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.bmp", io.BytesIO(content), "image/jpeg")},
        )
        assert response.status_code == 422
        assert "Extensão" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reject_empty_file(self, authenticated_client: AsyncClient):
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.jpg", io.BytesIO(b""), "image/jpeg")},
        )
        assert response.status_code == 422
        assert "vazio" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reject_oversized_file(self, authenticated_client: AsyncClient):
        # Create content just over 10MB
        content = make_jpeg_bytes(10 * 1024 * 1024 + 100)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        assert response.status_code == 422
        assert "grande" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reject_magic_bytes_mismatch(self, authenticated_client: AsyncClient):
        """File declared as JPEG but has PNG magic bytes."""
        content = make_png_bytes(256)
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        assert response.status_code == 422
        assert "corrompido" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reject_random_bytes_as_jpeg(self, authenticated_client: AsyncClient):
        """Random bytes should fail magic byte validation."""
        content = b"\x00\x01\x02\x03" * 64
        response = await authenticated_client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_unauthenticated(self, client: AsyncClient):
        response = await client.post(
            "/api/v1/upload/photo",
            files={"file": ("photo.jpg", io.BytesIO(b"x"), "image/jpeg")},
        )
        assert response.status_code == 401


# ===========================================================================
# Unit tests for helper functions
# ===========================================================================


class TestValidateMagicBytes:
    """Unit tests for _validate_magic_bytes."""

    def test_jpeg_valid(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(make_jpeg_bytes(), "image/jpeg") is True

    def test_jpeg_as_jpg(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(make_jpeg_bytes(), "image/jpg") is True

    def test_png_valid(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(make_png_bytes(), "image/png") is True

    def test_webp_valid(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(make_webp_bytes(), "image/webp") is True

    def test_heic_valid(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(make_heic_bytes(), "image/heic") is True

    def test_heif_valid(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(make_heic_bytes(), "image/heif") is True

    def test_invalid_magic_returns_false(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(b"\x00\x00\x00\x00" * 10, "image/jpeg") is False

    def test_png_declared_as_jpeg_returns_false(self):
        from app.modules.upload.router import _validate_magic_bytes
        assert _validate_magic_bytes(make_png_bytes(), "image/jpeg") is False

    def test_webp_without_webp_marker(self):
        """RIFF header without WEBP at offset 8 should fail."""
        from app.modules.upload.router import _validate_magic_bytes
        content = b"RIFF" + b"\x00" * 4 + b"XXXX"
        assert _validate_magic_bytes(content, "image/webp") is False

    def test_heic_without_ftyp(self):
        from app.modules.upload.router import _validate_magic_bytes
        content = b"\x00" * 20
        assert _validate_magic_bytes(content, "image/heic") is False


class TestGetLocalUrl:
    """Unit tests for _get_local_url."""

    def test_returns_correct_path(self):
        from app.modules.upload.router import _get_local_url
        assert "/uploads/abc.jpg" in _get_local_url("abc.jpg")


# ===========================================================================
# S3 upload path tests (mocked)
# ===========================================================================


class TestUploadToS3:
    """Tests for _upload_to_s3 function with mocked boto3."""

    @pytest.mark.asyncio
    async def test_upload_to_s3_with_endpoint(self):
        """Test S3 upload with custom endpoint (MinIO)."""
        from unittest.mock import MagicMock, patch

        from app.modules.upload.router import _upload_to_s3

        mock_client = MagicMock()
        mock_boto3 = MagicMock()
        mock_boto3.client.return_value = mock_client

        with patch.dict("sys.modules", {"boto3": mock_boto3, "botocore": MagicMock(), "botocore.exceptions": MagicMock()}):
            with patch("app.modules.upload.router.settings") as mock_settings:
                mock_settings.S3_ACCESS_KEY = "test-key"
                mock_settings.S3_SECRET_KEY = "test-secret"
                mock_settings.S3_ENDPOINT = "http://minio:9000"
                mock_settings.S3_PUBLIC_URL = None
                mock_settings.S3_BUCKET = "test-bucket"

                url = await _upload_to_s3(b"content", "photos/test.jpg", "image/jpeg")

                assert url == "http://minio:9000/test-bucket/photos/test.jpg"
                mock_client.put_object.assert_called_once()

    @pytest.mark.asyncio
    async def test_upload_to_s3_without_endpoint(self):
        """Test S3 upload with default AWS endpoint."""
        from unittest.mock import MagicMock, patch

        from app.modules.upload.router import _upload_to_s3

        mock_client = MagicMock()
        mock_boto3 = MagicMock()
        mock_boto3.client.return_value = mock_client

        with patch.dict("sys.modules", {"boto3": mock_boto3, "botocore": MagicMock(), "botocore.exceptions": MagicMock()}):
            with patch("app.modules.upload.router.settings") as mock_settings:
                mock_settings.S3_ACCESS_KEY = "test-key"
                mock_settings.S3_SECRET_KEY = "test-secret"
                mock_settings.S3_ENDPOINT = None
                mock_settings.S3_PUBLIC_URL = None
                mock_settings.S3_BUCKET = "my-bucket"

                url = await _upload_to_s3(b"content", "photos/test.jpg", "image/jpeg")

                assert url == "https://my-bucket.s3.amazonaws.com/photos/test.jpg"

    @pytest.mark.asyncio
    async def test_upload_to_s3_client_error(self):
        """Test S3 upload handles ClientError."""
        from unittest.mock import MagicMock, patch

        from fastapi import HTTPException

        from app.modules.upload.router import _upload_to_s3

        # Create real-looking exception classes
        class FakeClientError(Exception):
            pass

        class FakeBotoCoreError(Exception):
            pass

        mock_botocore_exceptions = MagicMock()
        mock_botocore_exceptions.BotoCoreError = FakeBotoCoreError
        mock_botocore_exceptions.ClientError = FakeClientError

        mock_client = MagicMock()
        mock_client.put_object.side_effect = FakeClientError("Access denied")

        mock_boto3 = MagicMock()
        mock_boto3.client.return_value = mock_client

        with patch.dict("sys.modules", {
            "boto3": mock_boto3,
            "botocore": MagicMock(),
            "botocore.exceptions": mock_botocore_exceptions,
        }):
            with patch("app.modules.upload.router.settings") as mock_settings:
                mock_settings.S3_ACCESS_KEY = "test-key"
                mock_settings.S3_SECRET_KEY = "test-secret"
                mock_settings.S3_ENDPOINT = None
                mock_settings.S3_BUCKET = "my-bucket"

                with pytest.raises(HTTPException) as exc_info:
                    await _upload_to_s3(b"content", "photos/test.jpg", "image/jpeg")
                assert exc_info.value.status_code == 500

    @pytest.mark.asyncio
    async def test_upload_photo_uses_s3_when_configured(
        self, authenticated_client: AsyncClient
    ):
        """Integration: upload endpoint uses S3 when S3_ACCESS_KEY is set."""
        from unittest.mock import AsyncMock, patch

        content = make_jpeg_bytes(256)

        with patch("app.modules.upload.router.settings") as mock_settings:
            mock_settings.S3_ACCESS_KEY = "configured-key"
            mock_settings.S3_SECRET_KEY = "configured-secret"
            mock_settings.S3_ENDPOINT = "http://minio:9000"
            mock_settings.S3_BUCKET = "test-bucket"

            with patch(
                "app.modules.upload.router._upload_to_s3",
                new_callable=AsyncMock,
                return_value="http://minio:9000/test-bucket/photos/abc.jpg",
            ) as mock_s3:
                response = await authenticated_client.post(
                    "/api/v1/upload/photo",
                    files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
                )
                assert response.status_code == 200
                assert response.json()["url"] == "http://minio:9000/test-bucket/photos/abc.jpg"
                mock_s3.assert_called_once()
