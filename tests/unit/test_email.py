"""Testes unitários do cliente de e-mail (SendGrid) e dos templates."""

from unittest.mock import MagicMock, patch

from app.core import email
from app.core.email_templates import password_reset_email, welcome_email


def _fake_settings(api_key: str):
    fake = MagicMock()
    fake.SENDGRID_API_KEY = api_key
    fake.FROM_EMAIL = "noreply@aems.com.br"
    return fake


class TestSendEmail:
    def test_noop_without_api_key(self):
        """Sem SENDGRID_API_KEY o envio é no-op (retorna False, não chama a rede)."""
        with patch("app.core.email.get_settings", return_value=_fake_settings("")):
            result = email.send_email("a@b.com", "Assunto", "<p>oi</p>", "oi")
        assert result is False

    def test_sends_with_api_key(self):
        """Com API key monta a mensagem e envia via SendGrid (2xx → True)."""
        mock_response = MagicMock(status_code=202)
        with (
            patch("app.core.email.get_settings", return_value=_fake_settings("SG.test")),
            patch("sendgrid.SendGridAPIClient") as MockClient,
        ):
            MockClient.return_value.send.return_value = mock_response
            result = email.send_email("a@b.com", "Assunto", "<p>oi</p>", "oi")
        assert result is True
        MockClient.return_value.send.assert_called_once()

    def test_raises_on_error_status(self):
        """Status >= 400 do SendGrid propaga erro (para a task Celery dar retry)."""
        mock_response = MagicMock(status_code=502)
        with (
            patch("app.core.email.get_settings", return_value=_fake_settings("SG.test")),
            patch("sendgrid.SendGridAPIClient") as MockClient,
        ):
            MockClient.return_value.send.return_value = mock_response
            try:
                email.send_email("a@b.com", "Assunto", "<p>oi</p>", "oi")
                raise AssertionError("deveria ter levantado")
            except RuntimeError:
                pass


class TestTemplates:
    def test_password_reset_email(self):
        subject, html, text = password_reset_email("Fulano", "https://x/reset-password?token=abc")
        assert "senha" in subject.lower()
        assert "https://x/reset-password?token=abc" in html
        assert "https://x/reset-password?token=abc" in text
        assert "Fulano" in html

    def test_welcome_email(self):
        subject, html, text = welcome_email("Beltrano", "https://x/reset-password?token=xyz")
        assert "senha" in subject.lower()
        assert "https://x/reset-password?token=xyz" in html
        assert "https://x/reset-password?token=xyz" in text
        assert "Beltrano" in html
