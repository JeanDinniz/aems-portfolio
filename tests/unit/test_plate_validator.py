"""Testes do validador compartilhado de placa/chassi (app/core/validators.py)."""

import pytest

from app.core.validators import (
    is_valid_plate_or_chassi,
    normalize_plate,
    validate_vehicle_plate,
)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("ABC1234", "ABC1234"),  # placa antiga
        ("ABC1D23", "ABC1D23"),  # placa Mercosul
        ("T4092175", "T4092175"),  # chassi do vidro (1 letra + dígitos)
        ("AB123456", "AB123456"),  # chassi do vidro (2 letras + dígitos)
        ("abc1d23", "ABC1D23"),  # normaliza minúsculas
        ("ABC-1234", "ABC1234"),  # remove hífen
        ("ABC 1D23", "ABC1D23"),  # remove espaço
    ],
)
def test_valores_validos(value, expected):
    assert validate_vehicle_plate(value) == expected
    assert is_valid_plate_or_chassi(value) is True


@pytest.mark.parametrize(
    "value",
    [
        "ABCE",  # 4 letras, sem dígito
        "ABC1",  # curto demais
        "AB12",  # curto demais
        "12345678",  # 8 dígitos sem letra
        "ABCDEFGH",  # 8 letras sem dígito
        "9BWZZZ377VT004251",  # VIN completo de 17 (não aceito)
        "",  # vazio
    ],
)
def test_valores_invalidos(value):
    assert is_valid_plate_or_chassi(value) is False
    with pytest.raises(ValueError):
        validate_vehicle_plate(value)


def test_normalize_plate():
    assert normalize_plate("abc-1d23") == "ABC1D23"
    assert normalize_plate(" t40 9217 5 ") == "T4092175"
