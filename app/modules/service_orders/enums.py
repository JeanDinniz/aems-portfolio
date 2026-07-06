"""
Service Order enums - Enumerations for service order module.
"""

from enum import StrEnum


class OSStatus(StrEnum):
    """Status possíveis de uma Ordem de Serviço."""

    WAITING = "waiting"  # Aguardando
    IN_PROGRESS = "in_progress"  # Fazendo
    COMPLETED = "completed"  # Pronto
    CANCELLED = "cancelled"  # Cancelada
    WRONG = "wrong"  # Lançado Errado
    DUPLICATE = "duplicate"  # Duplicado

    @property
    def label(self) -> str:
        """Retorna o label em português do status."""
        labels = {
            self.WAITING: "Aguardando",
            self.IN_PROGRESS: "Fazendo",
            self.COMPLETED: "Pronto",
            self.CANCELLED: "Cancelada",
            self.WRONG: "Lançado Errado",
            self.DUPLICATE: "Duplicado",
        }
        return labels[self]


class SemaphoreColor(StrEnum):
    """Cores do semáforo para controle de tempo de O.S."""

    WHITE = "white"  # Dentro do prazo
    YELLOW = "yellow"  # Atenção
    ORANGE = "orange"  # Atrasado
    RED = "red"  # Crítico

    @property
    def label(self) -> str:
        """Retorna o label em português da cor."""
        labels = {
            self.WHITE: "Branco",
            self.YELLOW: "Amarelo",
            self.ORANGE: "Laranja",
            self.RED: "Vermelho",
        }
        return labels[self]
