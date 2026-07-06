"""Add employees table and migrate service_order_workers from user_id to employee_id

Revision ID: 014
Revises: 013
Create Date: 2026-02-19

Mudanças:
  - Cria tabela `employees` (funcionários físicos das lojas, sem acesso ao sistema)
  - Adiciona coluna `employee_id` em `service_order_workers`
  - Remove coluna `user_id` de `service_order_workers`
  - Recria a view `v_installer_ranking` usando employees em vez de users
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '014'
down_revision: Union[str, None] = '013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # 1. Criar tabela employees
    # -------------------------------------------------------------------------
    op.create_table(
        'employees',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('store_id', sa.Integer(), sa.ForeignKey('stores.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )

    # -------------------------------------------------------------------------
    # 2. Criar índice em employees.store_id
    # -------------------------------------------------------------------------
    op.create_index('ix_employees_store_id', 'employees', ['store_id'])

    # -------------------------------------------------------------------------
    # 3. Adicionar coluna employee_id em service_order_workers (nullable inicialmente)
    #    para não quebrar caso existam dados na tabela.
    # -------------------------------------------------------------------------
    op.add_column(
        'service_order_workers',
        sa.Column('employee_id', sa.Integer(), nullable=True),
    )

    # -------------------------------------------------------------------------
    # 4. Dropar a view v_installer_ranking ANTES de remover user_id
    #    (a view depende da coluna user_id e bloquearia o drop_column)
    # -------------------------------------------------------------------------
    op.execute("DROP VIEW IF EXISTS v_installer_ranking")

    # -------------------------------------------------------------------------
    # 5. Remover a foreign key de user_id em service_order_workers
    # -------------------------------------------------------------------------
    op.drop_constraint(
        'service_order_workers_user_id_fkey',
        'service_order_workers',
        type_='foreignkey',
    )

    # -------------------------------------------------------------------------
    # 6. Remover a coluna user_id de service_order_workers
    # -------------------------------------------------------------------------
    op.drop_column('service_order_workers', 'user_id')

    # -------------------------------------------------------------------------
    # 7. Tornar employee_id NOT NULL
    # -------------------------------------------------------------------------
    op.alter_column(
        'service_order_workers',
        'employee_id',
        nullable=False,
    )

    # -------------------------------------------------------------------------
    # 8. Criar FK constraint de employee_id → employees.id
    # -------------------------------------------------------------------------
    op.create_foreign_key(
        'service_order_workers_employee_id_fkey',
        'service_order_workers',
        'employees',
        ['employee_id'],
        ['id'],
        ondelete='RESTRICT',
    )

    # -------------------------------------------------------------------------
    # 9. Recriar a view v_installer_ranking usando employees em vez de users
    # -------------------------------------------------------------------------

    op.execute("""
        CREATE OR REPLACE VIEW v_installer_ranking AS
        SELECT
            e.id AS employee_id,
            e.name AS full_name,
            e.store_id,
            st.name AS store_name,
            COUNT(DISTINCT sow.service_order_id) AS total_orders,
            COALESCE(SUM(sow.hours_worked), 0) AS total_hours,
            CASE
                WHEN COALESCE(SUM(sow.hours_worked), 0) > 0
                THEN ROUND(
                    COUNT(DISTINCT sow.service_order_id)::numeric
                    / SUM(sow.hours_worked)::numeric, 2
                )
                ELSE 0
            END AS productivity_score
        FROM service_order_workers sow
        JOIN service_orders so ON so.id = sow.service_order_id
            AND so.entry_time >= NOW() - INTERVAL '30 days'
        JOIN employees e ON e.id = sow.employee_id
        LEFT JOIN stores st ON st.id = e.store_id
        GROUP BY e.id, e.name, e.store_id, st.name
        ORDER BY total_orders DESC, productivity_score DESC
    """)


def downgrade() -> None:
    # -------------------------------------------------------------------------
    # Reverter em ordem inversa
    # -------------------------------------------------------------------------

    # 8. Restaurar a view v_installer_ranking com users
    op.execute("DROP VIEW IF EXISTS v_installer_ranking")

    op.execute("""
        CREATE OR REPLACE VIEW v_installer_ranking AS
        SELECT
            u.id AS user_id,
            u.full_name,
            u.store_id,
            st.name AS store_name,
            COUNT(DISTINCT sow.service_order_id)  AS total_orders,
            COALESCE(SUM(sow.hours_worked), 0)    AS total_hours,
            CASE
                WHEN COALESCE(SUM(sow.hours_worked), 0) > 0
                THEN ROUND(
                    COUNT(DISTINCT sow.service_order_id)::numeric
                    / SUM(sow.hours_worked)::numeric, 2
                )
                ELSE 0
            END AS productivity_score
        FROM service_order_workers sow
        JOIN service_orders so
            ON so.id = sow.service_order_id
            AND so.entry_time >= NOW() - INTERVAL '30 days'
        JOIN users u   ON u.id = sow.user_id
        LEFT JOIN stores st ON st.id = u.store_id
        GROUP BY u.id, u.full_name, u.store_id, st.name
        ORDER BY total_orders DESC, productivity_score DESC
    """)

    # 7. Remover FK de employee_id
    op.drop_constraint(
        'service_order_workers_employee_id_fkey',
        'service_order_workers',
        type_='foreignkey',
    )

    # 6. Tornar employee_id nullable antes de removê-la
    op.alter_column(
        'service_order_workers',
        'employee_id',
        nullable=True,
    )

    # 5. Recriar coluna user_id (nullable inicialmente para reversão segura)
    op.add_column(
        'service_order_workers',
        sa.Column('user_id', sa.Integer(), nullable=True),
    )

    # 4. Recriar FK de user_id → users.id
    op.create_foreign_key(
        'service_order_workers_user_id_fkey',
        'service_order_workers',
        'users',
        ['user_id'],
        ['id'],
        ondelete='RESTRICT',
    )

    # 3. Remover coluna employee_id
    op.drop_column('service_order_workers', 'employee_id')

    # 2. Remover índice de employees.store_id
    op.drop_index('ix_employees_store_id', table_name='employees')

    # 1. Remover tabela employees
    op.drop_table('employees')
