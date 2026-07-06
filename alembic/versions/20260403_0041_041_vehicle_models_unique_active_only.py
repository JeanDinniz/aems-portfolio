"""vehicle_models_unique_active_only

Revision ID: 041_vehicle_models_unique_active_only
Revises: 040_services_unique_active_only
Create Date: 2026-04-03 15:00:00.000000-03:00

Corrige o índice único de modelos de veículo para cobrir apenas registros ativos,
permitindo reutilizar nomes de modelos desativados.
"""

from alembic import op

revision = "041_vm_unique_active"
down_revision = "040_services_unique_active_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove o índice antigo (cobre registros ativos E inativos)
    op.drop_constraint("uq_vehicle_model_brand_name", "vehicle_models", type_="unique")

    # Recria como índice parcial: apenas registros ativos
    op.execute(
        """
        CREATE UNIQUE INDEX uq_vehicle_model_brand_name
        ON vehicle_models (brand_id, name)
        WHERE is_active = true
        """
    )


def downgrade() -> None:
    op.drop_index("uq_vehicle_model_brand_name", table_name="vehicle_models")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_vehicle_model_brand_name
        ON vehicle_models (brand_id, name)
        """
    )
