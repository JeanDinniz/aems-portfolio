"""add_can_delete_to_user_module_permissions

Revision ID: 043_add_can_delete_to_user_module_permissions
Revises: f86b335c4baa
Create Date: 2026-04-07 20:31:00.000000-03:00

Adiciona coluna `can_delete` em `user_module_permissions` para controle
granular de permissão de exclusão/cancelamento por módulo.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "043_add_can_delete"
down_revision: Union[str, None] = "f86b335c4baa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_module_permissions",
        sa.Column(
            "can_delete",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("user_module_permissions", "can_delete")
