"""Ponto Eletrônico (2/3): coordenadas e raio de geofence por loja.

latitude/longitude nullable (null = loja sem geofence; batida nunca é
bloqueada, apenas sinalizada fora do raio). geofence_radius_m default 200.

Revision ID: 20260714_097
Revises: 20260714_096
Create Date: 2026-07-14
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260714_097"
down_revision = "20260714_096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stores", sa.Column("latitude", sa.Numeric(9, 6), nullable=True))
    op.add_column("stores", sa.Column("longitude", sa.Numeric(9, 6), nullable=True))
    op.add_column(
        "stores",
        sa.Column("geofence_radius_m", sa.Integer(), nullable=False, server_default="200"),
    )


def downgrade() -> None:
    op.drop_column("stores", "geofence_radius_m")
    op.drop_column("stores", "longitude")
    op.drop_column("stores", "latitude")
