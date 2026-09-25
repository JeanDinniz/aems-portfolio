"""Saída avulsa de película (film_withdrawals).

Tabela film_withdrawals: metros entregues a um funcionário fora de O.S.
(pedaço de película para retrabalho/uso pessoal), com quem pediu, motivo,
quem registrou e estorno soft (reversed_at/reversed_by). store_id é snapshot
da loja da bobina no momento da saída. O débito/crédito de metros continua
no ledger film_consumptions, que ganha film_withdrawal_id para apontar a
origem (mesmo padrão do service_order_item_id).

Revision ID: 20260719_104
Revises: 20260717_103
Create Date: 2026-07-19
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260719_104"
down_revision = "20260717_103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "film_withdrawals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "film_roll_id",
            sa.Integer(),
            sa.ForeignKey("film_rolls.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "store_id",
            sa.Integer(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("meters", sa.Float(), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "reversed_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_film_withdrawals_film_roll_id", "film_withdrawals", ["film_roll_id"])
    op.create_index("ix_film_withdrawals_store_id", "film_withdrawals", ["store_id"])
    op.create_index("ix_film_withdrawals_employee_id", "film_withdrawals", ["employee_id"])
    op.create_index("ix_film_withdrawals_created_at", "film_withdrawals", ["created_at"])

    op.add_column(
        "film_consumptions",
        sa.Column(
            "film_withdrawal_id",
            sa.Integer(),
            sa.ForeignKey("film_withdrawals.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_film_consumptions_film_withdrawal_id",
        "film_consumptions",
        ["film_withdrawal_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_film_consumptions_film_withdrawal_id", table_name="film_consumptions")
    op.drop_column("film_consumptions", "film_withdrawal_id")
    op.drop_index("ix_film_withdrawals_created_at", table_name="film_withdrawals")
    op.drop_index("ix_film_withdrawals_employee_id", table_name="film_withdrawals")
    op.drop_index("ix_film_withdrawals_store_id", table_name="film_withdrawals")
    op.drop_index("ix_film_withdrawals_film_roll_id", table_name="film_withdrawals")
    op.drop_table("film_withdrawals")
