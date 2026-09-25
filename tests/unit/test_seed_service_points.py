from decimal import Decimal

from scripts.seed_service_points import normalize, points_for_code


def test_normalize_removes_spaces_and_uppercases():
    assert normalize("PPF KIT1") == "PPFKIT1"
    assert normalize("poli 1") == "POLI1"
    assert normalize(None) == ""


def test_points_for_known_codes():
    assert points_for_code("POLI1", None) == Decimal("1.00")
    assert points_for_code("WP2", None) == Decimal("0.50")
    assert points_for_code("PPF KIT18", None) == Decimal("0.25")
    assert points_for_code("PPF07", None) == Decimal("40.00")
    # apelidos sem zero à esquerda (códigos reais "PPF KIT1"/"PPF KIT2" = PPFKIT01/02)
    assert points_for_code("PPF KIT1", None) == Decimal("0.75")
    assert points_for_code("PPF KIT2", None) == Decimal("0.75")


def test_points_for_unknown_code_returns_none():
    assert points_for_code("ZZZ999", None) is None


def test_falls_back_to_category_when_code_missing():
    assert points_for_code(None, "POLI1") == Decimal("1.00")
