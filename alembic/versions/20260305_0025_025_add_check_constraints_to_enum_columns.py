"""Add CHECK constraints to all enum-like String columns

Revision ID: 025
Revises: 024
Create Date: 2026-03-05

Contexto:
  Adiciona CHECK constraints a todas as colunas String que armazenam valores
  de enums Python. Esta abordagem é preferida ao uso de ENUMs nativos do
  PostgreSQL porque CHECK constraints são mais fáceis de modificar sem
  downtime (ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT).

  Tabelas e colunas afetadas (18 constraints):
    1.  users.role
    2.  occurrences.occurrence_type        (condicional — tabela pode nao existir)
    3.  occurrences.severity               (condicional — tabela pode nao existir)
    4.  incidents.incident_type            (condicional — tabela pode nao existir)
    5.  incidents.status                   (condicional — tabela pode nao existir)
    6.  film_reels.film_type               (condicional — tabela pode nao existir)
    7.  film_reels.status                  (condicional — tabela pode nao existir)
    8.  purchase_requests.category         (condicional — tabela pode nao existir)
    9.  purchase_requests.urgency          (condicional — tabela pode nao existir)
    10. purchase_requests.status           (condicional — tabela pode nao existir)
    11. service_orders.department
    12. service_orders.status
    13. status_history.from_status  (nullable - NULL is allowed by CHECK)
    14. status_history.to_status
    15. services.department
    16. monthly_goals.department           (condicional — tabela pode nao existir)
    17. monthly_goals.goal_type            (condicional — tabela pode nao existir)
    18. quality_audits.status              (condicional — tabela pode nao existir)

  As tabelas marcadas como "condicional" podem ter sido removidas pelo ramo
  de remocao de tabelas (006_remove_reports_tables ate 010_remove_incidents_hr_tables)
  que diverge a partir de migration 005 e pode rodar antes deste ramo principal.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '025'
down_revision: Union[str, None] = '024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Adiciona CHECK constraints a todas as colunas enum-like (idempotente)."""

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # Padrao: DROP IF EXISTS + ADD para garantir idempotencia em todas as constraints.

    # 1. users.role
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role")
    op.execute("ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role IN ('owner', 'supervisor', 'operator'))")

    # 2-3. occurrences — removida em 010_remove_incidents_hr_tables
    if 'occurrences' in existing_tables:
        op.execute("ALTER TABLE occurrences DROP CONSTRAINT IF EXISTS ck_occurrences_occurrence_type")
        op.execute("ALTER TABLE occurrences ADD CONSTRAINT ck_occurrences_occurrence_type CHECK (occurrence_type IN ('absence', 'late_arrival', 'warning', 'suspension', 'other'))")
        op.execute("ALTER TABLE occurrences DROP CONSTRAINT IF EXISTS ck_occurrences_severity")
        op.execute("ALTER TABLE occurrences ADD CONSTRAINT ck_occurrences_severity CHECK (severity IN ('low', 'medium', 'high', 'critical'))")

    # 4-5. incidents — removida em 010_remove_incidents_hr_tables
    if 'incidents' in existing_tables:
        op.execute("ALTER TABLE incidents DROP CONSTRAINT IF EXISTS ck_incidents_incident_type")
        op.execute("ALTER TABLE incidents ADD CONSTRAINT ck_incidents_incident_type CHECK (incident_type IN ('vehicle_damage', 'equipment_damage', 'workplace_accident', 'customer_complaint', 'other'))")
        op.execute("ALTER TABLE incidents DROP CONSTRAINT IF EXISTS ck_incidents_status")
        op.execute("ALTER TABLE incidents ADD CONSTRAINT ck_incidents_status CHECK (status IN ('open', 'under_investigation', 'resolved', 'closed'))")

    # 6-7. film_reels — removida em 008_remove_inventory_tables
    if 'film_reels' in existing_tables:
        op.execute("ALTER TABLE film_reels DROP CONSTRAINT IF EXISTS ck_film_reels_film_type")
        op.execute("ALTER TABLE film_reels ADD CONSTRAINT ck_film_reels_film_type CHECK (film_type IN ('FUM35', 'FUM50', 'FUM70', 'CERA', 'NANO', 'SEG', 'PREM'))")
        op.execute("ALTER TABLE film_reels DROP CONSTRAINT IF EXISTS ck_film_reels_status")
        op.execute("ALTER TABLE film_reels ADD CONSTRAINT ck_film_reels_status CHECK (status IN ('in_stock', 'in_use', 'depleted'))")

    # 8-10. purchase_requests — removida em 009_remove_purchase_requests
    if 'purchase_requests' in existing_tables:
        op.execute("ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS ck_purchase_requests_category")
        op.execute("ALTER TABLE purchase_requests ADD CONSTRAINT ck_purchase_requests_category CHECK (category IN ('film', 'machines', 'uniforms'))")
        op.execute("ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS ck_purchase_requests_urgency")
        op.execute("ALTER TABLE purchase_requests ADD CONSTRAINT ck_purchase_requests_urgency CHECK (urgency IN ('normal', 'urgent', 'critical'))")
        op.execute("ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS ck_purchase_requests_status")
        op.execute("ALTER TABLE purchase_requests ADD CONSTRAINT ck_purchase_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'ordered', 'received'))")

    # 11. service_orders.department
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_department")
    op.execute("ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_department CHECK (department IN ('film', 'ppf', 'bodywork', 'vn', 'vu', 'workshop'))")

    # 12. service_orders.status
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_status")
    op.execute("ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_status CHECK (status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled'))")

    # 13. status_history.from_status (nullable — NULL e explicitamente permitido)
    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_from_status")
    op.execute("ALTER TABLE status_history ADD CONSTRAINT ck_status_history_from_status CHECK (from_status IS NULL OR from_status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled'))")

    # 14. status_history.to_status
    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_to_status")
    op.execute("ALTER TABLE status_history ADD CONSTRAINT ck_status_history_to_status CHECK (to_status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled'))")

    # 15. services.department
    op.execute("ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_department")
    op.execute("ALTER TABLE services ADD CONSTRAINT ck_services_department CHECK (department IN ('film', 'ppf', 'bodywork', 'vn', 'vu', 'workshop'))")

    # 16-17. monthly_goals — removida em 006_remove_reports_tables
    if 'monthly_goals' in existing_tables:
        op.execute("ALTER TABLE monthly_goals DROP CONSTRAINT IF EXISTS ck_monthly_goals_department")
        op.execute("ALTER TABLE monthly_goals ADD CONSTRAINT ck_monthly_goals_department CHECK (department IN ('film', 'ppf', 'bodywork', 'vn', 'vu', 'workshop'))")
        op.execute("ALTER TABLE monthly_goals DROP CONSTRAINT IF EXISTS ck_monthly_goals_goal_type")
        op.execute("ALTER TABLE monthly_goals ADD CONSTRAINT ck_monthly_goals_goal_type CHECK (goal_type IN ('revenue', 'os_count', 'quality_score'))")

    # 18. quality_audits — removida em 006_remove_reports_tables
    if 'quality_audits' in existing_tables:
        op.execute("ALTER TABLE quality_audits DROP CONSTRAINT IF EXISTS ck_quality_audits_status")
        op.execute("ALTER TABLE quality_audits ADD CONSTRAINT ck_quality_audits_status CHECK (status IN ('draft', 'completed', 'reviewed'))")


def downgrade() -> None:
    """Remove todas as CHECK constraints adicionadas no upgrade (idempotente)."""

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    if 'quality_audits' in existing_tables:
        op.execute("ALTER TABLE quality_audits DROP CONSTRAINT IF EXISTS ck_quality_audits_status")
    if 'monthly_goals' in existing_tables:
        op.execute("ALTER TABLE monthly_goals DROP CONSTRAINT IF EXISTS ck_monthly_goals_goal_type")
        op.execute("ALTER TABLE monthly_goals DROP CONSTRAINT IF EXISTS ck_monthly_goals_department")
    op.execute("ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_department")
    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_to_status")
    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_from_status")
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_status")
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_department")
    if 'purchase_requests' in existing_tables:
        op.execute("ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS ck_purchase_requests_status")
        op.execute("ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS ck_purchase_requests_urgency")
        op.execute("ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS ck_purchase_requests_category")
    if 'film_reels' in existing_tables:
        op.execute("ALTER TABLE film_reels DROP CONSTRAINT IF EXISTS ck_film_reels_status")
        op.execute("ALTER TABLE film_reels DROP CONSTRAINT IF EXISTS ck_film_reels_film_type")
    if 'incidents' in existing_tables:
        op.execute("ALTER TABLE incidents DROP CONSTRAINT IF EXISTS ck_incidents_status")
        op.execute("ALTER TABLE incidents DROP CONSTRAINT IF EXISTS ck_incidents_incident_type")
    if 'occurrences' in existing_tables:
        op.execute("ALTER TABLE occurrences DROP CONSTRAINT IF EXISTS ck_occurrences_severity")
        op.execute("ALTER TABLE occurrences DROP CONSTRAINT IF EXISTS ck_occurrences_occurrence_type")
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role")
