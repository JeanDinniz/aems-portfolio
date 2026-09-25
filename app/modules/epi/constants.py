"""Enums do módulo de EPI."""

from enum import StrEnum


class EntregaEPIStatus(StrEnum):
    """Status PERSISTIDO de uma linha de entrega. VENCIDO/PENDENTE são derivados."""

    ENTREGUE = "ENTREGUE"
    CANCELADA = "CANCELADA"


class PendenciaEstado(StrEnum):
    """Estado DERIVADO (não persistido) de um EPI exigido por cargo."""

    PENDENTE = "PENDENTE"  # nunca entregue
    VENCIDO = "VENCIDO"  # entregue, mas data_vencimento < hoje
    EM_DIA = "EM_DIA"  # entregue e válido
