"""Extend vehicle_plate column to 17 chars to support VIN/chassi

Revision ID: 028
Revises: 027
Create Date: 2026-03-21

Contexto:
  Veículos novos sem placa são identificados pelo número de chassi (VIN),
  que tem 17 caracteres. A coluna vehicle_plate era String(10), insuficiente.

  PostgreSQL não permite alterar o tipo de uma coluna referenciada por views.
  Se v_day_panel existir neste ponto (cenário em que o ramo de remoção rodou
  antes do ramo principal), ela precisa ser dropada antes do ALTER COLUMN e
  recriada depois. A view só é recriada se as colunas client_name/client_phone
  ainda existirem em service_orders.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '028'
down_revision: Union[str, None] = '027'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# SQL canônico de v_day_panel (criado em migration 013, inclui client_name/client_phone)
_V_DAY_PANEL_SQL = """
    CREATE OR REPLACE VIEW v_day_panel AS
    SELECT
        so.id,
        so.vehicle_plate,
        so.vehicle_brand,
        so.vehicle_model,
        so.vehicle_color,
        so.vehicle_year,
        so.department,
        so.status,
        so.entry_time,
        so.start_time,
        so.completion_time,
        so.delivery_time,
        so.notes,
        so.requires_invoice,
        so.invoice_number,
        so.client_name,
        so.client_phone,
        -- Loja
        so.store_id,
        st.name AS store_name,
        st.code AS store_code,
        -- Concessionaria
        so.dealership_id,
        d.name AS dealership_name,
        -- Consultor
        so.consultant_id,
        c.name AS consultant_name,
        -- Minutos aguardando (desde entry_time)
        EXTRACT(EPOCH FROM (NOW() - so.entry_time)) / 60 AS elapsed_minutes,
        -- Semaforo calculado
        CASE
            WHEN so.department = 'film' THEN
                CASE
                    WHEN EXTRACT(EPOCH FROM (NOW() - so.entry_time)) / 60 < 45  THEN 'white'
                    WHEN EXTRACT(EPOCH FROM (NOW() - so.entry_time)) / 60 < 90  THEN 'yellow'
                    WHEN EXTRACT(EPOCH FROM (NOW() - so.entry_time)) / 60 < 180 THEN 'orange'
                    ELSE 'red'
                END
            ELSE
                CASE
                    WHEN EXTRACT(EPOCH FROM (NOW() - so.entry_time)) / 60 < 30  THEN 'white'
                    WHEN EXTRACT(EPOCH FROM (NOW() - so.entry_time)) / 60 < 60  THEN 'yellow'
                    WHEN EXTRACT(EPOCH FROM (NOW() - so.entry_time)) / 60 < 120 THEN 'orange'
                    ELSE 'red'
                END
        END AS semaphore_color
    FROM service_orders so
    JOIN stores st ON st.id = so.store_id
    LEFT JOIN dealerships d ON d.id = so.dealership_id
    LEFT JOIN consultants c ON c.id = so.consultant_id
    WHERE
        so.status NOT IN ('delivered')
        AND so.entry_time::date = CURRENT_DATE
    ORDER BY so.entry_time ASC
"""


def _view_exists(conn) -> bool:
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.views "
        "WHERE table_schema = 'public' AND table_name = 'v_day_panel'"
    ))
    return result.fetchone() is not None


def _client_cols_exist(inspector) -> bool:
    cols = [c['name'] for c in inspector.get_columns('service_orders')]
    return 'client_name' in cols and 'client_phone' in cols


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    view_was_present = _view_exists(conn)

    # 1. Dropar a view se existir (PostgreSQL exige isso para alterar a coluna)
    if view_was_present:
        op.execute("DROP VIEW IF EXISTS v_day_panel")

    # 2. Alargar a coluna
    op.alter_column(
        'service_orders',
        'vehicle_plate',
        existing_type=sa.String(10),
        type_=sa.String(17),
        existing_nullable=False,
    )

    # 3. Recriar a view somente se existia E as colunas client_name/client_phone
    #    ainda estiverem presentes (indicam que o ramo de remoção não as removeu)
    if view_was_present and _client_cols_exist(inspector):
        op.execute(_V_DAY_PANEL_SQL)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    view_was_present = _view_exists(conn)

    if view_was_present:
        op.execute("DROP VIEW IF EXISTS v_day_panel")

    op.alter_column(
        'service_orders',
        'vehicle_plate',
        existing_type=sa.String(17),
        type_=sa.String(10),
        existing_nullable=False,
    )

    if view_was_present and _client_cols_exist(inspector):
        op.execute(_V_DAY_PANEL_SQL)
