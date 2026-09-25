"""Testes unitários para compute_display_status (regras de exibição de agendamento)."""

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.modules.scheduling.service import compute_display_status

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)
NEXT_WEEK = TODAY + timedelta(days=7)
# completion_time preenchido = O.S. foi finalizada alguma vez (imune ao rótulo 'wrong').
COMPLETED_AT = datetime(2026, 1, 10, tzinfo=UTC)


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


@pytest.mark.parametrize("os_status", ["completed", "cancelled"])
def test_os_status_concluido_ou_cancelado_eh_finalizado(os_status):
    """O.S. concluída/cancelada → 'finalizado' (sem botão Finalizar).

    'duplicate' tem display_status próprio 'duplicidade'.
    """
    assert compute_display_status(_appt(service_order_id=10), os_status) == "finalizado"


def test_os_wrong_com_completion_eh_finalizado():
    """ÂNCORA: O.S. finalizada e depois marcada 'wrong' na Conferência continua
    'finalizado' no Agendamento — 'wrong' não rebaixa mais o agendamento."""
    appt = _appt(delivery_date=YESTERDAY, service_order_id=10)
    assert compute_display_status(appt, "wrong", COMPLETED_AT) == "finalizado"


def test_os_wrong_sem_completion_eh_em_execucao():
    """O.S. 'wrong' que nunca foi finalizada (sem completion_time) → 'em_execucao',
    INDEPENDENTE da data (o rótulo 'wrong' é ignorado pelo Agendamento)."""
    assert compute_display_status(_appt(delivery_date=NEXT_WEEK, service_order_id=10), "wrong", None) == "em_execucao"
    assert compute_display_status(_appt(delivery_date=YESTERDAY, service_order_id=10), "wrong", None) == "em_execucao"


def test_os_ativa_com_completion_eh_finalizado():
    """Qualquer O.S. não-terminal mas com completion_time gravado → 'finalizado'."""
    appt = _appt(service_order_id=10)
    assert compute_display_status(appt, "in_progress", COMPLETED_AT) == "finalizado"


def test_os_duplicate_com_completion_ainda_duplicidade():
    """'duplicate' tem prioridade sobre completion_time."""
    appt = _appt(service_order_id=10)
    assert compute_display_status(appt, "duplicate", COMPLETED_AT) == "duplicidade"


def test_os_duplicate_retorna_duplicidade():
    """O.S. 'duplicate' → 'duplicidade' (não 'finalizado' nem 'em_execucao')."""
    appt = _appt(service_order_id=10)
    assert compute_display_status(appt, "duplicate") == "duplicidade"


def test_os_cancelled_com_data_vencida_prioriza_finalizado():
    """Mesmo com data vencida, O.S. cancelada não deve virar 'atrasado'."""
    appt = _appt(delivery_date=YESTERDAY, service_order_id=10)
    assert compute_display_status(appt, "cancelled") == "finalizado"


def test_os_duplicate_com_data_vencida_retorna_duplicidade():
    """O.S. duplicate com data vencida → 'duplicidade' (não 'atrasado')."""
    appt = _appt(delivery_date=YESTERDAY, service_order_id=10)
    assert compute_display_status(appt, "duplicate") == "duplicidade"


def test_os_ativa_vencida_eh_em_execucao_nao_atrasado():
    """Meio-termo: O.S. ativa com data vencida fica 'em_execucao' (não 'atrasado').
    O atraso vira marcador à parte (is_overdue)."""
    appt = _appt(delivery_date=YESTERDAY, service_order_id=10)
    assert compute_display_status(appt, "in_progress") == "em_execucao"
    assert compute_display_status(appt, "waiting") == "em_execucao"


def test_compute_is_overdue():
    from app.modules.scheduling.service import compute_is_overdue

    # vencido + em execução → overdue (mostra "Em execução" + "Atrasado")
    assert compute_is_overdue(_appt(delivery_date=YESTERDAY, service_order_id=10), "em_execucao") is True
    # sem O.S. vencido → overdue (é o próprio 'atrasado')
    assert compute_is_overdue(_appt(delivery_date=YESTERDAY), "atrasado") is True
    # no prazo (amanhã) → não overdue
    assert compute_is_overdue(_appt(delivery_date=TOMORROW), "atencao") is False
    # finalizado/cancelado nunca são overdue, mesmo vencidos
    assert compute_is_overdue(_appt(delivery_date=YESTERDAY, service_order_id=10), "finalizado") is False
    assert compute_is_overdue(_appt(status="cancelled", delivery_date=YESTERDAY), "cancelado") is False
