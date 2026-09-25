"""material requests: material_requests, material_request_tools + film_rolls.material_request_id

Cria o módulo de Pedidos de Material (substitui a planilha manual). Um pedido
agrupa bobinas (FilmRoll, vinculadas via material_request_id) e linhas de
ferramenta/insumo. A coluna em film_rolls é aditiva/nullable.

Revision ID: 20260814_116
Revises: 20260812_115
Create Date: 2026-08-14
"""

import sqlalchemy as sa
from alembic import op

revision = "20260814_116"
down_revision = "20260812_115"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "material_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("request_date", sa.Date(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_galpon", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_material_requests_store_id", "material_requests", ["store_id"])
    op.create_index("ix_material_requests_request_date", "material_requests", ["request_date"])

    op.create_table(
        "material_request_tools",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["request_id"], ["material_requests.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_material_request_tools_request_id", "material_request_tools", ["request_id"])

    op.add_column(
        "film_rolls",
        sa.Column("material_request_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_film_rolls_material_request_id",
        "film_rolls",
        "material_requests",
        ["material_request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_film_rolls_material_request_id", "film_rolls", ["material_request_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_film_rolls_material_request_id", table_name="film_rolls")
    op.drop_constraint("fk_film_rolls_material_request_id", "film_rolls", type_="foreignkey")
    op.drop_column("film_rolls", "material_request_id")
    op.drop_table("material_request_tools")
    op.drop_table("material_requests")
