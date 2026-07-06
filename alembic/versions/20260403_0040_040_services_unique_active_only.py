"""services_unique_active_only

Revision ID: 040_services_unique_active_only
Revises: 039_access_profiles
Create Date: 2026-04-03 14:00:00.000000-03:00

Corrige o índice único de serviços para cobrir apenas registros ativos,
permitindo reutilizar códigos de serviços desativados.
"""

from alembic import op

revision = "040_services_unique_active_only"
down_revision = "039_access_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove o índice antigo (cobre registros ativos E inativos)
    op.drop_index("uq_service_code_brand_dept", table_name="services")

    # Recria como índice parcial: apenas registros ativos
    op.execute(
        """
        CREATE UNIQUE INDEX uq_service_code_brand_dept
        ON services (code, brand_id, department)
        WHERE code IS NOT NULL AND is_active = true
        """
    )


def downgrade() -> None:
    op.drop_index("uq_service_code_brand_dept", table_name="services")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_service_code_brand_dept
        ON services (code, brand_id, department)
        WHERE code IS NOT NULL
        """
    )
