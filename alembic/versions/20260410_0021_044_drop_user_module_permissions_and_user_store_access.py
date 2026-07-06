"""drop_user_module_permissions_and_user_store_access

Revision ID: 044_drop_user_module_permissions_user_store_access
Revises: 043_add_can_delete_to_user_module_permissions
Create Date: 2026-04-10 00:21:00.000000-03:00

Remove as tabelas do sistema de permissões individuais por usuário.
O controle de acesso passa a ser gerenciado exclusivamente via Perfis de Acesso.
"""

from alembic import op

revision = "044_drop_user_mod_perms"
down_revision = "043_add_can_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("user_store_access")
    op.drop_table("user_module_permissions")


def downgrade() -> None:
    op.create_table(
        "user_module_permissions",
        *_user_module_permissions_columns(),
    )
    op.create_table(
        "user_store_access",
        *_user_store_access_columns(),
    )


def _user_module_permissions_columns():
    import sqlalchemy as sa
    return [
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module", sa.String(50), nullable=False),
        sa.Column("can_view", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("can_delete", sa.Boolean(), nullable=False, server_default="false"),
        sa.UniqueConstraint("user_id", "module", name="uq_user_module"),
    ]


def _user_store_access_columns():
    import sqlalchemy as sa
    return [
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("store_id", sa.Integer(), sa.ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True),
    ]
