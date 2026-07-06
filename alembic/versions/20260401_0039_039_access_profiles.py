"""access_profiles

Revision ID: 039_access_profiles
Revises: 038_access_logs_user_fk_set_null
Create Date: 2026-04-01 00:39:00.000000-03:00

Implementa o sistema de Perfis de Acesso configuráveis:
- Cria tabelas: access_profiles, access_profile_module_permissions,
  access_profile_stores, access_profile_users
- Remove tabelas legadas: user_store_supervision, user_store_access,
  user_module_permissions (se existirem)
- Migra role enum: remove 'supervisor'/'operator', mantém 'owner'/'user'
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "039_access_profiles"
down_revision = "038_access_logs_user_fk_set_null"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Criar tabela principal de perfis de acesso
    # ------------------------------------------------------------------
    op.create_table(
        "access_profiles",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column(
            "allows_loja",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "allows_galpon",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_access_profiles_name"),
    )
    op.create_index(
        "ix_access_profiles_name", "access_profiles", ["name"], unique=True
    )
    op.create_index(
        "ix_access_profiles_is_active", "access_profiles", ["is_active"], unique=False
    )

    # ------------------------------------------------------------------
    # 2. Criar tabela de permissões por módulo (por perfil)
    # ------------------------------------------------------------------
    op.create_table(
        "access_profile_module_permissions",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("module_group", sa.String(length=20), nullable=False),
        sa.Column("sub_module", sa.String(length=50), nullable=False),
        sa.Column(
            "can_view",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "can_edit",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "can_delete",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["access_profiles.id"],
            ondelete="CASCADE",
            name="fk_apmp_profile_id",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "profile_id", "sub_module", name="uq_apmp_profile_sub_module"
        ),
    )
    op.create_index(
        "ix_apmp_profile_id",
        "access_profile_module_permissions",
        ["profile_id"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # 3. Criar tabela M:N perfil <-> loja
    # ------------------------------------------------------------------
    op.create_table(
        "access_profile_stores",
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["access_profiles.id"],
            ondelete="CASCADE",
            name="fk_aps_profile_id",
        ),
        sa.ForeignKeyConstraint(
            ["store_id"],
            ["stores.id"],
            ondelete="CASCADE",
            name="fk_aps_store_id",
        ),
        sa.PrimaryKeyConstraint("profile_id", "store_id"),
    )

    # ------------------------------------------------------------------
    # 4. Criar tabela M:N perfil <-> usuário
    # ------------------------------------------------------------------
    op.create_table(
        "access_profile_users",
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["access_profiles.id"],
            ondelete="CASCADE",
            name="fk_apu_profile_id",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_apu_user_id",
        ),
        sa.PrimaryKeyConstraint("profile_id", "user_id"),
    )

    # ------------------------------------------------------------------
    # 5. Migrar dados de role: supervisor/operator → user
    # ------------------------------------------------------------------
    op.execute(
        "UPDATE users SET role = 'user' WHERE role IN ('supervisor', 'operator')"
    )

    # ------------------------------------------------------------------
    # 6. Recriar o enum de role como VARCHAR simples (owner, user)
    #    Para PostgreSQL precisamos trocar para VARCHAR, dropar o tipo
    #    antigo e recriar.
    # ------------------------------------------------------------------
    # Converter coluna para VARCHAR para liberar o tipo enum
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50)")

    # Dropar tipo antigo se existir
    op.execute("DROP TYPE IF EXISTS userrole CASCADE")

    # ------------------------------------------------------------------
    # 7. Dropar tabelas legadas (se existirem)
    # ------------------------------------------------------------------
    # user_store_supervision: estava em user model como secondary
    # Precisa dropar FK do store supervision também
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'user_store_supervision') THEN
                DROP TABLE user_store_supervision CASCADE;
            END IF;
        END$$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'user_store_access') THEN
                DROP TABLE user_store_access CASCADE;
            END IF;
        END$$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'user_module_permissions') THEN
                DROP TABLE user_module_permissions CASCADE;
            END IF;
        END$$;
        """
    )


def downgrade() -> None:
    # Recriar tabelas legadas
    op.create_table(
        "user_module_permissions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("module", sa.String(length=50), nullable=False),
        sa.Column("can_view", sa.Boolean(), nullable=False),
        sa.Column("can_edit", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "module"),
    )

    op.create_table(
        "user_store_access",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "store_id"),
    )

    op.create_table(
        "user_store_supervision",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "store_id"),
    )

    # Reverter roles para values antigos (impossível saber qual era qual)
    op.execute(
        "UPDATE users SET role = 'operator' WHERE role = 'user'"
    )

    # Dropar tabelas novas
    op.drop_table("access_profile_users")
    op.drop_table("access_profile_stores")
    op.drop_index("ix_apmp_profile_id", "access_profile_module_permissions")
    op.drop_table("access_profile_module_permissions")
    op.drop_index("ix_access_profiles_is_active", "access_profiles")
    op.drop_index("ix_access_profiles_name", "access_profiles")
    op.drop_table("access_profiles")
