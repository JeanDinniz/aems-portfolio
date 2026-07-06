"""Testes unitários do enriquecimento de film_entries em appointment_to_response.

Cobre o film_roll_code (bobina utilizada, vinda dos itens da O.S. gerada via
roll_map) exibido no detalhe do agendamento.
"""

from datetime import date, datetime
from types import SimpleNamespace

from app.modules.scheduling.service import appointment_to_response


def _appt(**over):
    base = dict(
        id=1,
        store_id=1,
        department="film",
        delivery_date=date.today(),
        delivery_time="10:00",
        external_os_number="7701",
        vehicle_plate="ABC1D23",
        vehicle_model="Dolphin",
        vehicle_color="Prata",
        consultant_id=None,
        consultant_name="Luana",
        service_ids=[7],
        notes=None,
        is_galpon=False,
        is_courtesy=False,
        is_return=False,
        film_type_id=None,
        film_tonality=None,
        film_entries=[{"service_id": 7, "tonality": "G05"}],
        status="scheduled",
        service_order_id=99,
        created_by_id=None,
        cancelled_at=None,
        cancellation_reason=None,
        created_at=datetime.now(),
        updated_at=datetime.now(),
        store=SimpleNamespace(name="BYD Unidade 05"),
        service_order=SimpleNamespace(
            status="completed",
            order_number="LJ05-2606-00004",
            notes=None,
            completion_photos=None,
        ),
    )
    base.update(over)
    return SimpleNamespace(**base)


SERVICE_MAP = {7: {"name": "Película Poliester Lateral e Traseira", "code": "POLI 1"}}


class TestFilmRollCode:
    def test_roll_map_preenche_film_roll_code(self):
        resp = appointment_to_response(_appt(), SERVICE_MAP, {(99, 7): "Poliester_G05_20022026"})
        fe = resp.film_entries[0]
        assert fe["film_roll_code"] == "Poliester_G05_20022026"
        assert fe["service_name"] == "Película Poliester Lateral e Traseira"
        assert fe["service_code"] == "POLI 1"

    def test_sem_roll_map_fica_none(self):
        resp = appointment_to_response(_appt(), SERVICE_MAP)
        assert resp.film_entries[0]["film_roll_code"] is None

    def test_roll_map_de_outra_os_nao_vaza(self):
        resp = appointment_to_response(_appt(), SERVICE_MAP, {(100, 7): "Poliester_G05_20022026"})
        assert resp.film_entries[0]["film_roll_code"] is None

    def test_sem_service_order_id_fica_none(self):
        appt = _appt(service_order_id=None, service_order=None)
        resp = appointment_to_response(appt, SERVICE_MAP, {(99, 7): "X"})
        assert resp.film_entries[0]["film_roll_code"] is None

    def test_sem_film_entries_nao_quebra(self):
        appt = _appt(film_entries=None)
        resp = appointment_to_response(appt, SERVICE_MAP, {(99, 7): "X"})
        assert resp.film_entries is None


class TestCompletionPhotosENotes:
    """Fotos da finalização (chancela/chassi) e observações da O.S. vinculada."""

    def test_completion_photos_json_valido(self):
        appt = _appt(
            service_order=SimpleNamespace(
                status="completed",
                order_number="LJ05-2606-00004",
                notes="VEND. BRUNO FERRO",
                completion_photos='["http://x/a.jpg", "http://x/b.jpg"]',
            )
        )
        resp = appointment_to_response(appt, SERVICE_MAP)
        assert resp.completion_photos == ["http://x/a.jpg", "http://x/b.jpg"]
        assert resp.service_order_notes == "VEND. BRUNO FERRO"

    def test_completion_photos_json_invalido_vira_none(self):
        appt = _appt(
            service_order=SimpleNamespace(
                status="completed",
                order_number="LJ05-2606-00004",
                notes=None,
                completion_photos="{corrompido",
            )
        )
        resp = appointment_to_response(appt, SERVICE_MAP)
        assert resp.completion_photos is None

    def test_sem_service_order_fica_none(self):
        appt = _appt(service_order_id=None, service_order=None)
        resp = appointment_to_response(appt, SERVICE_MAP)
        assert resp.completion_photos is None
        assert resp.service_order_notes is None
