"""add supplier and nfe_number to film_rolls

Revision ID: 057_supplier_nfe_film_rolls
Revises: 056_add_department_film_types
Create Date: 2026-04-29
"""

import sqlalchemy as sa
from alembic import op

revision = "057_supplier_nfe_film_rolls"
down_revision = "056_add_department_film_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("film_rolls", sa.Column("supplier", sa.String(200), nullable=True))
    op.add_column("film_rolls", sa.Column("nfe_number", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("film_rolls", "nfe_number")
    op.drop_column("film_rolls", "supplier")
