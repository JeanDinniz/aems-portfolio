"""
SystemSetting - configuração global do sistema no formato chave-valor (JSON).

Guarda parâmetros de escopo de sistema editáveis pelo Owner (ex.: metas de
faturamento por funcionário). Uma linha por chave; o valor é um JSON livre.
"""

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class SystemSetting(Base, TimestampMixin):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)

    def __repr__(self) -> str:
        return f"<SystemSetting {self.key}>"
