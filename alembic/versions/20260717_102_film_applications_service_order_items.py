"""Tonalidades por região do carro no item de O.S.

Coluna JSON film_applications em service_order_items: lista de aplicações
{tonality, region, film_roll_id, roll_code} quando um mesmo serviço de película
usa tonalidades diferentes por região (ex.: G20 nas portas dianteiras, G05 nas
traseiras). NULL = item legado com tonalidade única (colunas tonality,
film_roll_id e roll_code continuam sendo a fonte nesses casos e espelham a
primeira aplicação nos itens multi-tonalidade).

Revision ID: 20260717_102
Revises: 20260715_101
Create Date: 2026-07-17
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260717_102"
down_revision = "20260715_101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_order_items",
        sa.Column("film_applications", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("service_order_items", "film_applications")
