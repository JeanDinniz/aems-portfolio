"""
Unit tests for security utilities.
"""

import pytest

from app.core.exceptions import AuthenticationError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)


class TestPasswordHashing:
    """Tests for password hashing functions."""

    def test_password_hash_is_different_from_plain(self):
        """Password hash should be different from plain text."""
        password = "mysecurepassword"
        hashed = get_password_hash(password)
        assert hashed != password

    def test_verify_correct_password(self):
        """Correct password should verify successfully."""
        password = "mysecurepassword"
        hashed = get_password_hash(password)
        assert verify_password(password, hashed) is True

    def test_verify_incorrect_password(self):
        """Incorrect password should fail verification."""
        password = "mysecurepassword"
        wrong_password = "wrongpassword"
        hashed = get_password_hash(password)
        assert verify_password(wrong_password, hashed) is False

    def test_different_hashes_for_same_password(self):
        """Same password should produce different hashes (due to salt)."""
        password = "mysecurepassword"
        hash1 = get_password_hash(password)
        hash2 = get_password_hash(password)
        assert hash1 != hash2


class TestJWTTokens:
    """Tests for JWT token functions."""

    def test_create_access_token(self):
        """Access token should be created successfully."""
        data = {"sub": "123", "role": "user"}
        token, jti = create_access_token(data)
        assert token is not None
        assert isinstance(token, str)
        assert isinstance(jti, str)

    def test_create_refresh_token(self):
        """Refresh token should be created successfully."""
        data = {"sub": "123"}
        token, jti = create_refresh_token(data)
        assert token is not None
        assert isinstance(token, str)
        assert isinstance(jti, str)

    def test_decode_access_token(self):
        """Access token should decode correctly."""
        data = {"sub": "123", "role": "user"}
        token, _ = create_access_token(data)
        payload = decode_token(token)
        assert payload["sub"] == "123"
        assert payload["role"] == "user"
        assert payload["type"] == "access"

    def test_decode_refresh_token(self):
        """Refresh token should decode correctly."""
        data = {"sub": "456"}
        token, _ = create_refresh_token(data)
        payload = decode_token(token)
        assert payload["sub"] == "456"
        assert payload["type"] == "refresh"

    def test_decode_invalid_token(self):
        """Invalid token should raise AuthenticationError."""
        with pytest.raises(AuthenticationError):
            decode_token("invalid.token.here")

    def test_token_contains_expiration(self):
        """Token should contain expiration claim."""
        data = {"sub": "123"}
        token, _ = create_access_token(data)
        payload = decode_token(token)
        assert "exp" in payload
