"""Instalador por serviço: vincula service_order_workers ao item.

Coluna service_order_item_id (nullable) em service_order_workers permite
registrar QUAL serviço cada instalador fez (Película/Pel. Segurança/PPF),
em vez de apenas "trabalhou na O.S.". NULL preserva o comportamento
anterior (funcionário da O.S. inteira) para dados históricos e demais
departamentos. ondelete=SET NULL: item recriado em edição não apaga o
registro do funcionário — ele apenas volta a valer para a O.S. inteira.

Revision ID: 20260713_094
Revises: 20260709_093
Create Date: 2026-07-13
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260713_094"
down_revision = "20260709_093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_order_workers",
        sa.Column("service_order_item_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_service_order_workers_item_id",
        "service_order_workers",
        "service_order_items",
        ["service_order_item_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_service_order_workers_service_order_item_id",
        "service_order_workers",
        ["service_order_item_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_service_order_workers_service_order_item_id",
        table_name="service_order_workers",
    )
    op.drop_constraint(
        "fk_service_order_workers_item_id",
        "service_order_workers",
        type_="foreignkey",
    )
    op.drop_column("service_order_workers", "service_order_item_id")
