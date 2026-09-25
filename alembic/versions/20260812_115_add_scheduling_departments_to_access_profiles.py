"""access_profiles: departamentos visíveis no Agendamento

Adiciona a coluna scheduling_departments (JSON, default []) ao perfil de acesso.
Lista vazia = sem restrição (comportamento atual). Uma lista de códigos de
departamento restringe o que o usuário enxerga no módulo de Agendamentos.

Aditivo — perfis existentes recebem [] via server_default.

Revision ID: 20260812_115
Revises: 20260811_114
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op

revision = "20260812_115"
down_revision = "20260811_114"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "access_profiles",
        sa.Column(
            "scheduling_departments",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("access_profiles", "scheduling_departments")
