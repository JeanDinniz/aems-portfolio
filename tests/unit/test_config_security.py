"""
Testes unitários para validação de segurança do config.py.
Valida que SECRET_KEY não aceita valores inseguros.
"""

import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.config import Settings


class TestSecretKeyValidation:
    """Testes para validação de SECRET_KEY."""

    def test_empty_secret_key_raises_error(self):
        """SECRET_KEY vazia deve gerar erro."""
        with patch.dict(os.environ, {"SECRET_KEY": ""}, clear=False):
            with pytest.raises(ValidationError) as exc_info:
                Settings()

            assert "SECRET_KEY não pode estar vazia" in str(exc_info.value)

    def test_whitespace_secret_key_raises_error(self):
        """SECRET_KEY com apenas espaços deve gerar erro."""
        with patch.dict(os.environ, {"SECRET_KEY": "   "}, clear=False):
            with pytest.raises(ValidationError) as exc_info:
                Settings()

            assert "SECRET_KEY não pode estar vazia" in str(exc_info.value)

    def test_default_value_raises_error(self):
        """SECRET_KEY com valor padrão deve gerar erro."""
        with patch.dict(os.environ, {"SECRET_KEY": "CHANGE-THIS-SECRET-KEY-IN-PRODUCTION"}, clear=False):
            with pytest.raises(ValidationError) as exc_info:
                Settings()

            assert "valor padrão inseguro" in str(exc_info.value)

    def test_insecure_values_raise_error(self):
        """Valores inseguros conhecidos devem gerar erro."""
        insecure_values = [
            "secret",
            "SECRET",  # Case insensitive
            "secretkey",
            "mysecret",
            "change-me",
            "development-secret-key-change-in-production",
        ]

        for insecure_value in insecure_values:
            with patch.dict(os.environ, {"SECRET_KEY": insecure_value}, clear=False):
                with pytest.raises(ValidationError) as exc_info:
                    Settings()

                assert "valor padrão inseguro" in str(exc_info.value), \
                    f"Failed for value: {insecure_value}"

    def test_short_secret_key_raises_error(self):
        """SECRET_KEY com menos de 32 caracteres deve gerar erro."""
        short_key = "short-key-123"  # 13 caracteres
        assert len(short_key) < 32

        with patch.dict(os.environ, {"SECRET_KEY": short_key}, clear=False):
            with pytest.raises(ValidationError) as exc_info:
                Settings()

            assert "no mínimo 32 caracteres" in str(exc_info.value)

    def test_valid_secret_key_accepted(self):
        """SECRET_KEY válida (32+ caracteres, aleatória) deve ser aceita."""
        # Chave gerada com secrets.token_urlsafe(32) - 43 caracteres
        valid_key = "-9KNxo1dpL8KU2uWRslXk40UdZIBhD6ejPU00ljNZwc"
        assert len(valid_key) >= 32

        with patch.dict(os.environ, {"SECRET_KEY": valid_key}, clear=False):
            settings = Settings()
            assert settings.SECRET_KEY == valid_key

    def test_minimum_valid_secret_key_accepted(self):
        """SECRET_KEY com exatamente 32 caracteres deve ser aceita."""
        min_valid_key = "a" * 32
        assert len(min_valid_key) == 32

        with patch.dict(os.environ, {"SECRET_KEY": min_valid_key}, clear=False):
            settings = Settings()
            assert settings.SECRET_KEY == min_valid_key

    def test_long_secret_key_accepted(self):
        """SECRET_KEY com mais de 32 caracteres deve ser aceita."""
        long_key = "a" * 64
        assert len(long_key) > 32

        with patch.dict(os.environ, {"SECRET_KEY": long_key}, clear=False):
            settings = Settings()
            assert settings.SECRET_KEY == long_key

    def test_error_message_includes_generation_command(self):
        """Mensagem de erro deve incluir comando para gerar chave segura."""
        with patch.dict(os.environ, {"SECRET_KEY": "short"}, clear=False):
            with pytest.raises(ValidationError) as exc_info:
                Settings()

            error_message = str(exc_info.value)
            assert "python -c" in error_message
            assert "secrets.token_urlsafe(32)" in error_message

    def test_validation_is_case_insensitive(self):
        """Validação de valores inseguros deve ser case-insensitive."""
        # "secret" em diferentes cases
        for insecure_value in ["SECRET", "Secret", "sEcReT"]:
            with patch.dict(os.environ, {"SECRET_KEY": insecure_value}, clear=False):
                with pytest.raises(ValidationError) as exc_info:
                    Settings()

                assert "valor padrão inseguro" in str(exc_info.value)
