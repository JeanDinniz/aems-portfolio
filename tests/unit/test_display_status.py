"""Testes unitários para compute_display_status (regras de exibição de agendamento)."""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.modules.scheduling.service import compute_display_status

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)
NEXT_WEEK = TODAY + timedelta(days=7)


def _appt(status="scheduled", delivery_date=TODAY, service_order_id=None):
    return SimpleNamespace(
        status=status,
        delivery_date=delivery_date,
        service_order_id=service_order_id,
    )


def test_agendamento_cancelado():
    assert compute_display_status(_appt(status="cancelled"), None) == "cancelado"


def test_sem_os_futuro_eh_agendado():
    assert compute_display_status(_appt(delivery_date=NEXT_WEEK), None) == "agendado"


def test_sem_os_amanha_eh_atencao():
    assert compute_display_status(_appt(delivery_date=TOMORROW), None) == "atencao"


def test_sem_os_vencido_eh_atrasado():
    assert compute_display_status(_appt(delivery_date=YESTERDAY), None) == "atrasado"


def test_os_em_andamento_eh_em_execucao():
    appt = _appt(service_order_id=10)
    assert compute_display_status(appt, "in_progress") == "em_execucao"
    assert compute_display_status(appt, "waiting") == "em_execucao"


def test_os_completed_eh_finalizado():
    assert compute_display_status(_appt(service_order_id=10), "completed") == "finalizado"


@pytest.mark.parametrize("os_status", ["completed", "cancelled", "wrong", "duplicate"])
def test_os_status_terminal_nao_oferece_finalizar(os_status):
    """O.S. em status terminal/não-finalizável → 'finalizado' (sem botão Finalizar).

    Regressão do bug: O.S. 'duplicate' aparecia como 'em_execucao' e oferecia
    Finalizar, gerando 422 no backend.
    """
    assert compute_display_status(_appt(service_order_id=10), os_status) == "finalizado"


@pytest.mark.parametrize("os_status", ["duplicate", "wrong", "cancelled"])
def test_os_terminal_tem_prioridade_sobre_data_vencida(os_status):
    """Mesmo com data vencida, O.S. terminal não deve virar 'atrasado'."""
    appt = _appt(delivery_date=YESTERDAY, service_order_id=10)
    assert compute_display_status(appt, os_status) == "finalizado"
