"""
Service Order workflows - State machine and business rules for status transitions.
"""

from app.core.exceptions import ValidationError
from app.modules.service_orders.enums import OSStatus

# Valid status transitions
# Obs.: DUPLICATE é definido automaticamente na criação (bypass da máquina, igual a
# WAITING/CANCELLED). Só permitimos SAIR dele (resolução manual de falso positivo ou
# início de trabalho); nunca é destino manual a partir de outros status.
STATUS_TRANSITIONS: dict[OSStatus, set[OSStatus]] = {
    OSStatus.WAITING: {OSStatus.IN_PROGRESS, OSStatus.COMPLETED, OSStatus.WRONG},
    OSStatus.IN_PROGRESS: {OSStatus.WAITING, OSStatus.COMPLETED, OSStatus.WRONG},
    OSStatus.COMPLETED: {OSStatus.WRONG},
    OSStatus.WRONG: {OSStatus.WAITING},
    OSStatus.DUPLICATE: {OSStatus.WAITING, OSStatus.IN_PROGRESS, OSStatus.WRONG},
}


def can_transition(from_status: OSStatus, to_status: OSStatus) -> bool:
    """
    Verifica se uma transição de status é válida.

    Args:
        from_status: Status atual
        to_status: Status desejado

    Returns:
        True se a transição é válida, False caso contrário
    """
    if from_status == to_status:
        return False
    return to_status in STATUS_TRANSITIONS.get(from_status, set())


def validate_transition(from_status: str, to_status: str) -> None:
    """
    Valida uma transição de status e lança exceção se inválida.

    Args:
        from_status: Status atual
        to_status: Status desejado

    Raises:
        ValidationError: Se a transição for inválida
    """
    try:
        from_status_enum = OSStatus(from_status)
        to_status_enum = OSStatus(to_status)
    except ValueError as e:
        raise ValidationError(detail=f"Status inválido: {from_status} ou {to_status}") from e

    if not can_transition(from_status_enum, to_status_enum):
        raise ValidationError(
            detail=f"Transição inválida: {from_status_enum.label} → {to_status_enum.label}"
        )
