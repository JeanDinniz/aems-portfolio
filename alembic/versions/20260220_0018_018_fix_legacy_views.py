"""Fix legacy views: v_installer_ranking uses employee_id, v_day_panel cleanup

Revision ID: 018
Revises: 017
Create Date: 2026-02-20

Problemas:
  - v_installer_ranking: JOIN users u ON u.id = sow.user_id
    A coluna user_id foi removida de service_order_workers na migration 014;
    a tabela usa employee_id. A view quebrava com erro de coluna inexistente.
  - v_day_panel: sem mudancas necessarias (dealership_id ainda existe e e nullable).
"""

from typing import Sequence, Union

from alembic import op

revision: str = '018'
down_revision: Union[str, None] = '017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Recreate v_installer_ranking using employee_id instead of user_id."""

    op.execute("DROP VIEW IF EXISTS v_installer_ranking")

    op.execute("""
        CREATE OR REPLACE VIEW v_installer_ranking AS
        SELECT
            e.id                                          AS employee_id,
            e.name                                        AS full_name,
            e.store_id,
            st.name                                       AS store_name,
            COUNT(DISTINCT sow.service_order_id)          AS total_orders,
            COALESCE(SUM(sow.hours_worked), 0)            AS total_hours,
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
        JOIN employees e   ON e.id = sow.employee_id
        LEFT JOIN stores st ON st.id = e.store_id
        GROUP BY e.id, e.name, e.store_id, st.name
        ORDER BY total_orders DESC, productivity_score DESC
    """)


def downgrade() -> None:
    """Restore v_installer_ranking to original (legacy user_id version)."""

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
