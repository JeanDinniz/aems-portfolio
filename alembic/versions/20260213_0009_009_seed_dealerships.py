"""Seed dealerships for existing stores

Revision ID: 009
Revises: 008
Create Date: 2026-02-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '009'
down_revision: Union[str, None] = '008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Insert dealerships for each existing store."""

    # Insert dealerships using subqueries to get store_id from stores table
    dealerships_data = [
        ("Concessionária Toyota Unidade 01", "LJ01", "Toyota", "Endereço da Concessionária Toyota Unidade 01"),
        ("Concessionária Toyota Unidade 02", "LJ02", "Toyota", "Endereço da Concessionária Toyota Unidade 02"),
        ("Concessionária Toyota Unidade 03", "LJ03", "Toyota", "Endereço da Concessionária Toyota Unidade 03"),
        ("Concessionária BYD Unidade 04", "LJ04", "BYD", "Endereço da Concessionária BYD Unidade 04"),
        ("Concessionária BYD Unidade 05", "LJ05", "BYD", "Endereço da Concessionária BYD Unidade 05"),
        ("Concessionária BYD Unidade 06", "LJ06", "BYD", "Endereço da Concessionária BYD Unidade 06"),
        ("Concessionária BYD Unidade 07", "LJ07", "BYD", "Endereço da Concessionária BYD Unidade 07"),
        ("Concessionária BYD Unidade 08", "LJ08", "BYD", "Endereço da Concessionária BYD Unidade 08"),
        ("Concessionária Hyundai Unidade 09", "LJ09", "Hyundai", "Endereço da Concessionária Hyundai Unidade 09"),
        ("Concessionária Hyundai Unidade 10", "LJ10", "Hyundai", "Endereço da Concessionária Hyundai Unidade 10"),
        ("Concessionária Fiat Unidade 11", "LJ11", "Fiat", "Endereço da Concessionária Fiat Unidade 11"),
        ("Concessionária Fiat Unidade 12", "LJ12", "Fiat", "Endereço da Concessionária Fiat Unidade 12"),
    ]

    for name, store_code, brand, address in dealerships_data:
        op.execute(
            f"""
            INSERT INTO dealerships (name, store_id, brand, address, is_active, created_at, updated_at)
            SELECT
                '{name}',
                stores.id,
                '{brand}',
                '{address}',
                true,
                NOW(),
                NOW()
            FROM stores
            WHERE stores.code = '{store_code}'
            """
        )


def downgrade() -> None:
    """Delete the seeded dealerships."""

    # Delete dealerships that were created by this migration
    # We identify them by matching the name pattern "Concessionária [Brand] [Location]"
    dealership_names = [
        "Concessionária Toyota Unidade 01",
        "Concessionária Toyota Unidade 02",
        "Concessionária Toyota Unidade 03",
        "Concessionária BYD Unidade 04",
        "Concessionária BYD Unidade 05",
        "Concessionária BYD Unidade 06",
        "Concessionária BYD Unidade 07",
        "Concessionária BYD Unidade 08",
        "Concessionária Hyundai Unidade 09",
        "Concessionária Hyundai Unidade 10",
        "Concessionária Fiat Unidade 11",
        "Concessionária Fiat Unidade 12",
    ]

    for name in dealership_names:
        op.execute(
            f"""
            DELETE FROM dealerships
            WHERE name = '{name}'
            """
        )
