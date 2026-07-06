"""Add database views and triggers for AEMS

Revision ID: 013
Revises: 012
Create Date: 2026-02-19

Views criadas:
  - v_day_panel: Painel do dia com semaforo
  - v_installer_ranking: Ranking de instaladores (ultimos 30 dias)
  - v_film_reel_status: Status das bobinas de pelicula por loja
    (criada condicionalmente — tabela film_reels pode ja ter sido removida)

Triggers criados:
  - trg_service_orders_updated: Atualiza updated_at em service_orders
  - trg_generate_order_number: Gera order_number automatico antes de inserir
  - trg_film_usage_update_reel: Atualiza remaining_length_meters em film_reels
    (criado condicionalmente — tabela film_usage_logs pode ja ter sido removida)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '013'
down_revision: Union[str, None] = '012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create views, functions and triggers."""

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()

    # -------------------------------------------------------------------------
    # VIEW: v_day_panel
    # O.S. do dia (nao entregues), com dados de loja, concessionaria,
    # consultor, servicos e funcionarios
    # -------------------------------------------------------------------------
    op.execute("""
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
    """)

    # -------------------------------------------------------------------------
    # VIEW: v_installer_ranking
    # Ranking de instaladores (ultimos 30 dias)
    # -------------------------------------------------------------------------
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

    # -------------------------------------------------------------------------
    # VIEW: v_film_reel_status
    # Status das bobinas de pelicula por loja
    # Criada condicionalmente: film_reels pode ja ter sido removida pelo ramo
    # de remocao de tabelas que diverge a partir de migration 005.
    # -------------------------------------------------------------------------
    if 'film_reels' in existing_tables:
        op.execute("""
            CREATE OR REPLACE VIEW v_film_reel_status AS
            SELECT
                fr.id,
                fr.smart_id,
                fr.store_id,
                st.name AS store_name,
                fr.film_type,
                fr.nominal_length_meters,
                fr.used_length_meters,
                fr.remaining_length_meters,
                fr.status,
                fr.received_at,
                fr.first_use_at,
                fr.depleted_at,
                CASE
                    WHEN fr.nominal_length_meters > 0
                    THEN ROUND(
                        (fr.used_length_meters / fr.nominal_length_meters * 100)::numeric, 2
                    )
                    ELSE 0
                END AS yield_percentage
            FROM film_reels fr
            JOIN stores st ON st.id = fr.store_id
            ORDER BY fr.store_id, fr.status, fr.received_at DESC
        """)

    # -------------------------------------------------------------------------
    # FUNCTION + TRIGGER: trg_service_orders_updated
    # Atualiza updated_at em service_orders antes de UPDATE
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_service_orders_set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER trg_service_orders_updated
        BEFORE UPDATE ON service_orders
        FOR EACH ROW
        EXECUTE FUNCTION fn_service_orders_set_updated_at()
    """)

    # -------------------------------------------------------------------------
    # FUNCTION + TRIGGER: trg_generate_order_number
    # Gera order_number automatico antes de INSERT em service_orders
    # Formato: {store_code}-{YYMM}-{SEQ:05d}
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_generate_order_number()
        RETURNS TRIGGER AS $$
        DECLARE
            v_store_code  VARCHAR(10);
            v_year_month  VARCHAR(4);
            v_seq         INTEGER;
            v_order_num   VARCHAR(30);
        BEGIN
            -- Somente gerar se order_number for NULL
            IF NEW.order_number IS NOT NULL THEN
                RETURN NEW;
            END IF;

            -- Buscar codigo da loja
            SELECT code INTO v_store_code
            FROM stores
            WHERE id = NEW.store_id;

            -- YYMM da entrada
            v_year_month := TO_CHAR(NEW.entry_time, 'YYMM');

            -- Proximo numero sequencial no mes para essa loja
            SELECT COALESCE(MAX(
                CAST(
                    SUBSTRING(order_number FROM '[0-9]+$') AS INTEGER
                )
            ), 0) + 1
            INTO v_seq
            FROM service_orders
            WHERE store_id = NEW.store_id
              AND order_number LIKE v_store_code || '-' || v_year_month || '-%';

            v_order_num := v_store_code || '-' || v_year_month || '-' || LPAD(v_seq::TEXT, 5, '0');
            NEW.order_number := v_order_num;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)

    op.execute("""
        CREATE TRIGGER trg_generate_order_number
        BEFORE INSERT ON service_orders
        FOR EACH ROW
        EXECUTE FUNCTION fn_generate_order_number()
    """)

    # -------------------------------------------------------------------------
    # FUNCTION + TRIGGER: trg_film_usage_update_reel
    # AFTER INSERT em film_usage_logs: atualiza remaining_length_meters em film_reels
    # Criado condicionalmente: film_usage_logs pode ja ter sido removida pelo ramo
    # de remocao de tabelas que diverge a partir de migration 005.
    # -------------------------------------------------------------------------
    if 'film_usage_logs' in existing_tables:
        op.execute("""
            CREATE OR REPLACE FUNCTION fn_film_usage_update_reel()
            RETURNS TRIGGER AS $$
            BEGIN
                UPDATE film_reels
                SET
                    used_length_meters      = used_length_meters + NEW.meters_used,
                    remaining_length_meters = remaining_length_meters - NEW.meters_used,
                    first_use_at = COALESCE(first_use_at, NEW.used_at),
                    status = CASE
                        WHEN (remaining_length_meters - NEW.meters_used) <= 0 THEN 'depleted'
                        ELSE 'in_use'
                    END,
                    depleted_at = CASE
                        WHEN (remaining_length_meters - NEW.meters_used) <= 0 THEN NOW()
                        ELSE depleted_at
                    END
                WHERE id = NEW.film_reel_id;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """)

        op.execute("""
            CREATE TRIGGER trg_film_usage_update_reel
            AFTER INSERT ON film_usage_logs
            FOR EACH ROW
            EXECUTE FUNCTION fn_film_usage_update_reel()
        """)


def downgrade() -> None:
    """Drop triggers, functions and views."""

    # Drop triggers
    op.execute("DROP TRIGGER IF EXISTS trg_film_usage_update_reel ON film_usage_logs")
    op.execute("DROP TRIGGER IF EXISTS trg_generate_order_number ON service_orders")
    op.execute("DROP TRIGGER IF EXISTS trg_service_orders_updated ON service_orders")

    # Drop functions
    op.execute("DROP FUNCTION IF EXISTS fn_film_usage_update_reel()")
    op.execute("DROP FUNCTION IF EXISTS fn_generate_order_number()")
    op.execute("DROP FUNCTION IF EXISTS fn_service_orders_set_updated_at()")

    # Drop views
    op.execute("DROP VIEW IF EXISTS v_film_reel_status")
    op.execute("DROP VIEW IF EXISTS v_installer_ranking")
    op.execute("DROP VIEW IF EXISTS v_day_panel")
