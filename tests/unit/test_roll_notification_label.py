"""
Testes unitários de ``_roll_notification_label`` (app.modules.inventory.service).

O helper monta a descrição legível/rastreável da bobina usada no título/corpo
das notificações de limiar de estoque (ver ``_notify_threshold_crossed``).
Formato: "Bobina {tipo}{ tonalidade} · {DD/MM/AAAA} [{metros}m] ({loja})",
com fallback "Loja #{store_id}" quando ``roll.store`` não está carregado.

Os objetos usados aqui são transientes (nunca adicionados à sessão) — o
helper só lê atributos em memória, sem precisar de banco.
"""

from datetime import date

from app.modules.inventory.models import FilmRoll, FilmType
from app.modules.inventory.service import _roll_notification_label
from app.modules.stores.models import Store


def _make_roll(
    *,
    tonality: str | None,
    total_meters: float,
    receipt_date: date,
    film_type_name: str,
    store: Store | None,
    store_id: int,
) -> FilmRoll:
    roll = FilmRoll(
        store_id=store_id,
        film_type_id=1,
        tonality=tonality,
        total_meters=total_meters,
        remaining_meters=total_meters,
        receipt_date=receipt_date,
        status="em_uso",
    )
    roll.film_type = FilmType(name=film_type_name, department="film")
    roll.store = store
    return roll


class TestRollNotificationLabelWithTonalityAndStore:
    def test_label_contains_all_components(self):
        store = Store(name="Hyundai Unidade 10", code="LJ07")
        roll = _make_roll(
            tonality="G20",
            total_meters=30.7,
            receipt_date=date(2026, 8, 31),
            film_type_name="WindowBlue",
            store=store,
            store_id=7,
        )

        label = _roll_notification_label(roll)

        assert label.startswith("Bobina ")
        assert "WindowBlue" in label
        assert "G20" in label
        assert "31/08/2026" in label
        assert "[30m]" in label  # metros truncados para inteiro
        assert "(Hyundai Unidade 10)" in label

    def test_exact_format(self):
        store = Store(name="Hyundai Unidade 10", code="LJ07")
        roll = _make_roll(
            tonality="G20",
            total_meters=30.0,
            receipt_date=date(2026, 8, 31),
            film_type_name="WindowBlue",
            store=store,
            store_id=7,
        )

        label = _roll_notification_label(roll)

        assert label == "Bobina WindowBlue G20 · 31/08/2026 [30m] (Hyundai Unidade 10)"


class TestRollNotificationLabelWithoutTonality:
    def test_ppf_has_no_duplicated_space(self):
        """PPF não tem tonalidade — não deve sobrar espaço duplo entre tipo e data."""
        store = Store(name="Matriz", code="LJ01")
        roll = _make_roll(
            tonality=None,
            total_meters=15.0,
            receipt_date=date(2026, 1, 5),
            film_type_name="PPF",
            store=store,
            store_id=1,
        )

        label = _roll_notification_label(roll)

        assert label == "Bobina PPF · 05/01/2026 [15m] (Matriz)"
        assert "  " not in label


class TestRollNotificationLabelStoreFallback:
    def test_store_none_uses_store_id_fallback(self):
        """Quando roll.store não está carregado (None), cai no fallback 'Loja #{id}'."""
        roll = _make_roll(
            tonality="G05",
            total_meters=10.0,
            receipt_date=date(2026, 3, 10),
            film_type_name="Nano",
            store=None,
            store_id=42,
        )

        label = _roll_notification_label(roll)

        assert "(Loja #42)" in label
        assert label == "Bobina Nano G05 · 10/03/2026 [10m] (Loja #42)"
