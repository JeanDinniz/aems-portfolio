"""add payment fields to consultants

Revision ID: 046_add_payment_fields_to_consultants
Revises: 045_replace_allows_loja_galpon_with_is_galpon_profile
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa

revision = "046_payment_consultants"
down_revision = "045_is_galpon_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("consultants", sa.Column("pix_key", sa.String(200), nullable=True))
    op.add_column("consultants", sa.Column("bank_name", sa.String(100), nullable=True))
    op.add_column("consultants", sa.Column("bank_agency", sa.String(20), nullable=True))
    op.add_column("consultants", sa.Column("bank_account", sa.String(30), nullable=True))
    op.add_column("consultants", sa.Column("bank_account_type", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("consultants", "bank_account_type")
    op.drop_column("consultants", "bank_account")
    op.drop_column("consultants", "bank_agency")
    op.drop_column("consultants", "bank_name")
    op.drop_column("consultants", "pix_key")
