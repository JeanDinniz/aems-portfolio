"""unique_name_constraints_stores_consultants_employees

Revision ID: 20260521_071
Revises: 20260519_070
Create Date: 2026-05-21
"""

from alembic import op

revision = "20260521_071"
down_revision = "20260519_070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_store_name_brand", "stores", ["name", "brand_id"])
    op.create_unique_constraint("uq_consultant_name_store", "consultants", ["name", "store_id"])
    op.create_unique_constraint("uq_employee_name_store", "employees", ["name", "store_id"])


def downgrade() -> None:
    op.drop_constraint("uq_store_name_brand", "stores", type_="unique")
    op.drop_constraint("uq_consultant_name_store", "consultants", type_="unique")
    op.drop_constraint("uq_employee_name_store", "employees", type_="unique")
