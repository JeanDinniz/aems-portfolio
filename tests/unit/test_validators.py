"""
Unit tests for app.core.validators.

Covers:
- validate_password_strength: all individual rules, boundary conditions,
  valid passwords, and negative (failing) cases.
- sanitize_text: XSS injection patterns are rejected, safe text passes.
- validate_photo_url: valid HTTP/HTTPS/relative URLs pass, dangerous schemes
  and XSS-embedded URLs are rejected.
- validate_photo_list: delegation to validate_photo_url per item.
"""

import pytest

from app.core.validators import (
    sanitize_text,
    validate_password_strength,
    validate_photo_list,
    validate_photo_url,
)

# ===========================================================================
# validate_password_strength
# ===========================================================================


class TestValidatePasswordStrengthValid:
    """Positive cases: passwords that meet every requirement."""

    @pytest.mark.parametrize(
        "password",
        [
            "Abcdef1!",          # exactly 8 chars, all rules satisfied
            "MyP@ssw0rd",        # typical strong password
            "Tr0ub4dor&3",       # 12 chars with special character
            "Abc123!@#XYZ",      # multiple special chars
            "A" * 5 + "a1!xxxxx",  # uppercase, lowercase, digit, special, long
        ],
    )
    def test_valid_password_returns_unchanged(self, password: str) -> None:
        """A valid password is returned as-is."""
        assert validate_password_strength(password) == password


class TestValidatePasswordStrengthTooShort:
    """Passwords under 8 characters must be rejected."""

    @pytest.mark.parametrize(
        "password",
        [
            "",         # empty string
            "A1!a",     # 4 chars
            "Ab1!xyz",  # 7 chars — one below boundary
        ],
    )
    def test_too_short_raises_value_error(self, password: str) -> None:
        with pytest.raises(ValueError, match="mínimo 8 caracteres"):
            validate_password_strength(password)


class TestValidatePasswordStrengthMissingUppercase:
    """Password without any uppercase letter must be rejected."""

    @pytest.mark.parametrize(
        "password",
        [
            "abcdef1!",
            "all_lower_1@",
            "nouppercase99!",
        ],
    )
    def test_missing_uppercase_raises_value_error(self, password: str) -> None:
        with pytest.raises(ValueError, match="letra maiúscula"):
            validate_password_strength(password)


class TestValidatePasswordStrengthMissingLowercase:
    """Password without any lowercase letter must be rejected."""

    @pytest.mark.parametrize(
        "password",
        [
            "ABCDEF1!",
            "ALL_UPPER_1@",
            "NOLOWER99!",
        ],
    )
    def test_missing_lowercase_raises_value_error(self, password: str) -> None:
        with pytest.raises(ValueError, match="letra minúscula"):
            validate_password_strength(password)


class TestValidatePasswordStrengthMissingDigit:
    """Password without any digit must be rejected."""

    @pytest.mark.parametrize(
        "password",
        [
            "Abcdefg!",
            "NoDigits@Here",
            "AbcXyz!@#",
        ],
    )
    def test_missing_digit_raises_value_error(self, password: str) -> None:
        with pytest.raises(ValueError, match="número"):
            validate_password_strength(password)


class TestValidatePasswordStrengthMissingSpecial:
    """Password without a special character must be rejected."""

    @pytest.mark.parametrize(
        "password",
        [
            "Abcdef12",
            "NoSpecial1A",
            "Password123",
        ],
    )
    def test_missing_special_raises_value_error(self, password: str) -> None:
        with pytest.raises(ValueError, match="caractere especial"):
            validate_password_strength(password)


class TestValidatePasswordStrengthBoundaryLength:
    """Boundary tests at exactly 7 and 8 characters."""

    def test_seven_chars_with_all_rules_fails(self) -> None:
        """7 chars with all char classes present still fails (length < 8)."""
        # 7 chars: uppercase, lowercase, digit, special -> still too short
        with pytest.raises(ValueError, match="mínimo 8 caracteres"):
            validate_password_strength("Aa1!xyz"[:7])  # "Aa1!xyz" is 7 chars

    def test_eight_chars_with_all_rules_passes(self) -> None:
        """8 chars with all char classes present passes."""
        assert validate_password_strength("Aa1!xyzw") == "Aa1!xyzw"


# ===========================================================================
# sanitize_text
# ===========================================================================


class TestSanitizeTextValid:
    """Positive cases: plain text and safe content passes without modification."""

    @pytest.mark.parametrize(
        "text",
        [
            "Carro Toyota Corolla prata",
            "Observações: veículo com riscos na porta dianteira direita",
            "Preço: R$ 150,00 - Desconto 10%",
            "5 < 10 e 10 > 5",          # angle brackets in math context
            "a@b.com",                   # email-like text
            "",                          # empty string is allowed
            "<strong>negrito</strong>",  # plain HTML tags without event handlers
            "url: http://example.com",
        ],
    )
    def test_safe_text_passes(self, text: str) -> None:
        """Safe text is returned unchanged."""
        assert sanitize_text(text) == text


class TestSanitizeTextXSSRejected:
    """Negative cases: known XSS payloads must raise ValueError."""

    @pytest.mark.parametrize(
        "text",
        [
            "<script>alert(1)</script>",
            "<SCRIPT>evil()</SCRIPT>",              # uppercase
            "  <script  >evil()</script>",          # spaces around tag name
            "javascript:alert(document.cookie)",
            "JAVASCRIPT:void(0)",                   # uppercase scheme
            '<img onerror="evil()">',               # inline event handler
            '<img onload="evil()">',
            '<button onclick="evil()">click</button>',
            "<iframe src='http://evil.com'>",
            "<IFRAME src='http://evil.com'>",
            "<object data='evil.swf'>",
            "<embed src='evil.swf'>",
            "<link rel='import' href='evil.html'>",
            "<svg onload='evil()'>",
        ],
    )
    def test_xss_pattern_raises_value_error(self, text: str) -> None:
        with pytest.raises(ValueError, match="perigoso"):
            sanitize_text(text)


# ===========================================================================
# validate_photo_url
# ===========================================================================


class TestValidatePhotoUrlValid:
    """Positive cases: valid photo URL schemes and safe paths."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://cdn.example.com/photos/car.jpg",
            "http://localhost:9000/bucket/image.png",
            "https://s3.amazonaws.com/my-bucket/photo-01.jpeg",
        ],
    )
    def test_valid_url_passes(self, url: str) -> None:
        """Valid URLs are returned unchanged."""
        assert validate_photo_url(url) == url


class TestValidatePhotoUrlInvalidScheme:
    """Negative cases: non-http/https schemes must be rejected."""

    @pytest.mark.parametrize(
        "url",
        [
            "javascript:alert(1)",
            "data:text/html,<h1>evil</h1>",
            "ftp://files.example.com/photo.jpg",
            "file:///etc/passwd",
            "vbscript:msgbox(1)",
            "/static/uploads/photo.jpg",        # relative URL (no scheme)
            "",                                  # empty string (no scheme)
        ],
    )
    def test_invalid_scheme_raises_value_error(self, url: str) -> None:
        with pytest.raises(ValueError, match="protocolo inválido"):
            validate_photo_url(url)


class TestValidatePhotoUrlXSSEmbedded:
    """Negative cases: XSS patterns embedded within an otherwise valid URL."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://cdn.example.com/<script>evil()</script>",
            "https://cdn.example.com/img?x=<iframe>",
        ],
    )
    def test_xss_in_url_raises_value_error(self, url: str) -> None:
        with pytest.raises(ValueError, match="perigoso"):
            validate_photo_url(url)


# ===========================================================================
# validate_photo_list
# ===========================================================================


class TestValidatePhotoList:
    """Tests for the list-level validator that delegates to validate_photo_url."""

    def test_all_valid_urls_returned_as_list(self) -> None:
        urls = [
            "https://cdn.example.com/a.jpg",
            "https://cdn.example.com/b.jpg",
            "https://cdn.example.com/c.jpg",
        ]
        result = validate_photo_list(urls)
        assert result == urls

    def test_empty_list_returns_empty_list(self) -> None:
        assert validate_photo_list([]) == []

    def test_single_invalid_url_raises(self) -> None:
        urls = [
            "https://cdn.example.com/good.jpg",
            "javascript:evil()",
            "https://cdn.example.com/also-good.jpg",
        ]
        with pytest.raises(ValueError, match="protocolo inválido"):
            validate_photo_list(urls)

    def test_xss_in_list_raises(self) -> None:
        urls = [
            "https://cdn.example.com/good.jpg",
            "https://cdn.example.com/<script>x</script>",
        ]
        with pytest.raises(ValueError, match="perigoso"):
            validate_photo_list(urls)

    def test_validates_each_element_independently(self) -> None:
        """Only the offending URL should trigger the error, not the entire list."""
        valid_urls = [f"https://cdn.example.com/{i}.jpg" for i in range(5)]
        offending = ["ftp://files.example.com/photo.jpg"]
        with pytest.raises(ValueError):
            validate_photo_list(valid_urls + offending)
