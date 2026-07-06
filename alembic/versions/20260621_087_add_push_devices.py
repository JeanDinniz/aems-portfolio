"""add push_devices table

Revision ID: 20260621_087
Revises: 20260621_086
Create Date: 2026-06-21

Contexto:
  Cria a tabela push_devices para registro de tokens FCM/APNs do app mobile.
  Cada token e unico no sistema (UNIQUE constraint). Quando o mesmo token
  e re-registrado por outro usuario (troca de conta no aparelho), o registro
  e atualizado pela camada de servico.

  Campos:
    - id              PK serial
    - user_id         FK → users.id ON DELETE CASCADE (indexed)
    - token           String(512) UNIQUE NOT NULL (indexed)
    - platform        String(10) NOT NULL  ('ios' | 'android')
    - app_version     String(32) nullable
    - created_at      timestamptz NOT NULL default now()
    - last_seen       timestamptz NOT NULL default now()
"""

import sqlalchemy as sa

from alembic import op

revision = "20260621_087"
down_revision = "20260621_086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        sa.Column("platform", sa.String(length=10), nullable=False),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_push_devices_token"),
    )
    op.create_index("ix_push_devices_token", "push_devices", ["token"], unique=True)
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_push_devices_user_id", table_name="push_devices")
    op.drop_index("ix_push_devices_token", table_name="push_devices")
    op.drop_table("push_devices")
