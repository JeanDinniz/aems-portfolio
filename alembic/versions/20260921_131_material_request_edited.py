"""material request edited: material_requests.edited_at, edited_by_user_id

Permite corrigir um pedido de material já lançado deixando rastro: quem editou
e quando (o de→para completo vai para a Auditoria via log_audit). NULL nesses
campos = pedido nunca editado. edited_by_user_id usa SET NULL ao excluir o
usuário, como created_by_user_id.

Revision ID: 20260921_131
Revises: 20260903_130
Create Date: 2026-09-21
"""

import sqlalchemy as sa

from alembic import op

revision = "20260921_131"
down_revision = "20260903_130"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_requests",
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "material_requests",
        sa.Column("edited_by_user_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_material_requests_edited_by_user_id_users",
        "material_requests",
        "users",
        ["edited_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_material_requests_edited_by_user_id_users",
        "material_requests",
        type_="foreignkey",
    )
    op.drop_column("material_requests", "edited_by_user_id")
    op.drop_column("material_requests", "edited_at")
