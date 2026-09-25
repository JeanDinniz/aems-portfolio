"""employees: cpf (necessário para AFD/AEJ do ponto)

Adiciona employees.cpf (nullable, só dígitos). A marcação tipo 7 do AFD e o AEJ
(Portaria 671) exigem o CPF do trabalhador. Aditivo — não toca dados existentes.

Revision ID: 20260805_113
Revises: 20260805_112
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_113"
down_revision = "20260805_112"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("cpf", sa.String(length=11), nullable=True))


def downgrade() -> None:
    op.drop_column("employees", "cpf")
