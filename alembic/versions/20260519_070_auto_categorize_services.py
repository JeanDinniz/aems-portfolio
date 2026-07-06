"""auto_categorize_services

Revision ID: 20260519_070
Revises: 20260519_069
Create Date: 2026-05-19
"""

from alembic import op

revision = "20260519_070"
down_revision = "20260519_069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE services
        SET category = 'ppf'
        WHERE department = 'ppf'
          AND category IS NULL
    """)

    op.execute("""
        UPDATE services
        SET category = 'pelicula_seguranca'
        WHERE department = 'film'
          AND name ILIKE '%Segurança%'
          AND category IS NULL
    """)

    op.execute("""
        UPDATE services
        SET category = 'insulfilm'
        WHERE department = 'film'
          AND name NOT ILIKE '%Segurança%'
          AND category IS NULL
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE services
        SET category = NULL
        WHERE department IN ('film', 'ppf')
    """)
