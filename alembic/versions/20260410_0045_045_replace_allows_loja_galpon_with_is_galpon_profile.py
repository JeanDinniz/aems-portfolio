"""replace_allows_loja_galpon_with_is_galpon_profile

Revision ID: 045_replace_allows_loja_galpon_with_is_galpon_profile
Revises: 044_drop_user_module_permissions_user_store_access
Create Date: 2026-04-10 00:45:00.000000-03:00

Remove colunas allows_loja e allows_galpon da tabela access_profiles.
Adiciona coluna is_galpon_profile que indica se o perfil opera com OS
do tipo galpão (instalação em veículos novos).
"""

import sqlalchemy as sa

from alembic import op

revision = "045_is_galpon_profile"
down_revision = "044_drop_user_mod_perms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("access_profiles", "allows_loja")
    op.drop_column("access_profiles", "allows_galpon")
    op.add_column(
        "access_profiles",
        sa.Column(
            "is_galpon_profile",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("access_profiles", "is_galpon_profile")
    op.add_column(
        "access_profiles",
        sa.Column(
            "allows_galpon",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "access_profiles",
        sa.Column(
            "allows_loja",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
