"""Seed do e-book: popula ebook_items com os 23 verbetes oficiais.

Idempotente: insere apenas os slugs que ainda não existem, então pode ser
reaplicada com segurança em qualquer ambiente. O conteúdo vem de
``app.modules.ebook.seed_data.EBOOK_SEED``.

Revision ID: 20260715_100
Revises: 20260715_099
Create Date: 2026-07-15
"""

import sqlalchemy as sa

from alembic import op
from app.modules.ebook.seed_data import EBOOK_SEED

# revision identifiers, used by Alembic.
revision = "20260715_100"
down_revision = "20260715_099"
branch_labels = None
depends_on = None


def _table() -> sa.Table:
    """Tabela leve com os tipos necessários para (de)serializar as colunas JSON."""
    return sa.table(
        "ebook_items",
        sa.column("category", sa.String()),
        sa.column("group", sa.String()),
        sa.column("slug", sa.String()),
        sa.column("title", sa.String()),
        sa.column("display_order", sa.Integer()),
        sa.column("description", sa.Text()),
        sa.column("procedure", sa.JSON()),
        sa.column("benefits", sa.JSON()),
        sa.column("care_notes", sa.Text()),
        sa.column("durability", sa.String()),
        sa.column("technical_data", sa.JSON()),
        sa.column("security_scenarios", sa.JSON()),
        sa.column("sales_approach", sa.Text()),
        sa.column("sales_faq", sa.JSON()),
        sa.column("sales_closing", sa.Text()),
    )


def _to_row(item: dict) -> dict:
    return {
        "category": item["category"],
        "group": item.get("group"),
        "slug": item["slug"],
        "title": item["title"],
        "display_order": item.get("display_order", 0),
        "description": item.get("description"),
        "procedure": item.get("procedure"),
        "benefits": item.get("benefits"),
        "care_notes": item.get("care_notes"),
        "durability": item.get("durability"),
        "technical_data": item.get("technical_data"),
        "security_scenarios": item.get("security_scenarios"),
        "sales_approach": item.get("sales_approach"),
        "sales_faq": item.get("sales_faq"),
        "sales_closing": item.get("sales_closing"),
    }


def upgrade() -> None:
    conn = op.get_bind()
    existing = set(conn.execute(sa.text("SELECT slug FROM ebook_items")).scalars().all())
    rows = [_to_row(item) for item in EBOOK_SEED if item["slug"] not in existing]
    if rows:
        conn.execute(_table().insert(), rows)


def downgrade() -> None:
    conn = op.get_bind()
    slugs = [item["slug"] for item in EBOOK_SEED]
    if slugs:
        table = _table()
        conn.execute(table.delete().where(table.c.slug.in_(slugs)))
