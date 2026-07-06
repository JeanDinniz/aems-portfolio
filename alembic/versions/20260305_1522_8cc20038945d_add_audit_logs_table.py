"""add_audit_logs_table

Revision ID: 8cc20038945d
Revises: 025
Create Date: 2026-03-05 15:22:20.293084-03:00

Cria a tabela audit_logs para rastreabilidade de acoes sensiveis do sistema:
  - Alteracoes de role de usuario
  - Ativacao / Desativacao de usuario
  - Criacao e atualizacao de usuario
  - Reset de senha administrativo
  - Aprovacao / Rejeicao de solicitacoes de compra (individual e em lote)
  - Aprovacao parcial de solicitacoes de compra

Campos:
  - id           : PK serial
  - user_id      : FK para users (nullable - acoes de sistema nao tem usuario)
  - action       : identificador da acao (ex: role_changed, user_deactivated)
  - resource_type: tipo do recurso afetado (ex: user, purchase_request)
  - resource_id  : ID do recurso afetado (nullable)
  - old_value    : JSON com estado anterior (nullable)
  - new_value    : JSON com novo estado (nullable)
  - ip_address   : IP do cliente (IPv4/IPv6, max 45 chars)
  - user_agent   : User-Agent HTTP (max 500 chars, truncado se maior)
  - created_at   : timestamp com timezone, default=now()

Indices:
  - ix_audit_logs_user_id            : consultas por usuario
  - ix_audit_logs_action             : consultas por tipo de acao
  - ix_audit_logs_resource_type      : consultas por tipo de recurso
  - ix_audit_logs_resource_type_action: consultas de auditoria combinadas
  - ix_audit_logs_user_created       : historico por usuario ao longo do tempo
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8cc20038945d'
down_revision: Union[str, None] = '025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Cria a tabela audit_logs e seus indices."""
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=100), nullable=False),
        sa.Column('resource_type', sa.String(length=50), nullable=False),
        sa.Column('resource_id', sa.Integer(), nullable=True),
        sa.Column('old_value', sa.JSON(), nullable=True),
        sa.Column('new_value', sa.JSON(), nullable=True),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['user_id'],
            ['users.id'],
            ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id'),
    )

    # Indices simples
    op.create_index(
        op.f('ix_audit_logs_user_id'),
        'audit_logs',
        ['user_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_audit_logs_action'),
        'audit_logs',
        ['action'],
        unique=False,
    )
    op.create_index(
        op.f('ix_audit_logs_resource_type'),
        'audit_logs',
        ['resource_type'],
        unique=False,
    )

    # Indices compostos para consultas de auditoria
    op.create_index(
        'ix_audit_logs_resource_type_action',
        'audit_logs',
        ['resource_type', 'action'],
        unique=False,
    )
    op.create_index(
        'ix_audit_logs_user_created',
        'audit_logs',
        ['user_id', 'created_at'],
        unique=False,
    )


def downgrade() -> None:
    """Remove a tabela audit_logs e todos os seus indices."""
    op.drop_index('ix_audit_logs_user_created', table_name='audit_logs')
    op.drop_index('ix_audit_logs_resource_type_action', table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_resource_type'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_user_id'), table_name='audit_logs')
    op.drop_table('audit_logs')
