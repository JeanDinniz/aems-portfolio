"""retalho: service_order_items.used_scrap + scrap_source_roll_id

Marca que o serviço foi feito com RETALHO (sobra de cortes anteriores, já
debitada da bobina na época) — nesse caso a bobina em uso NÃO é debitada de
novo. `scrap_source_roll_id` é opcional e pode apontar para bobina já esgotada
(o pedaço costuma vir de rolo antigo).

Itens multi-tonalidade guardam as mesmas chaves dentro de `film_applications`
(JSON) — sem coluna nova.

Revision ID: 20260824_127
Revises: 20260824_126
Create Date: 2026-08-24
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_127"
down_revision = "20260824_126"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_order_items",
        sa.Column(
            "used_scrap",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "service_order_items",
        sa.Column("scrap_source_roll_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_service_order_items_scrap_source_roll_id",
        "service_order_items",
        ["scrap_source_roll_id"],
    )
    op.create_foreign_key(
        "fk_service_order_items_scrap_source_roll_id",
        "service_order_items",
        "film_rolls",
        ["scrap_source_roll_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_service_order_items_scrap_source_roll_id",
        "service_order_items",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_service_order_items_scrap_source_roll_id",
        table_name="service_order_items",
    )
    op.drop_column("service_order_items", "scrap_source_roll_id")
    op.drop_column("service_order_items", "used_scrap")
