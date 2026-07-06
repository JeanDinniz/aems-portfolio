"""005_phase5_reports

Revision ID: 005_phase5_reports
Revises: 004_phase4_hr_incidents
Create Date: 2026-01-27

Phase 5: Relatórios e BI
- Monthly Goals (Metas mensais)
- Quality Audits (Auditorias de qualidade)
- Metrics Cache (Cache de métricas)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create Phase 5 tables."""

    # ========================================
    # MONTHLY GOALS
    # ========================================
    op.create_table(
        "monthly_goals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("department", sa.String(length=20), nullable=False),
        sa.Column("year_month", sa.String(length=7), nullable=False),  # Format: YYYY-MM
        sa.Column("goal_value", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("goal_type", sa.String(length=30), nullable=False, server_default="revenue"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["store_id"],
            ["stores.id"],
            name="fk_monthly_goals_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name="fk_monthly_goals_created_by",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "store_id", "department", "year_month", "goal_type",
            name="uq_monthly_goals_store_dept_month_type"
        ),
    )

    # Indexes for monthly_goals
    op.create_index("ix_monthly_goals_store_id", "monthly_goals", ["store_id"])
    op.create_index("ix_monthly_goals_department", "monthly_goals", ["department"])
    op.create_index("ix_monthly_goals_year_month", "monthly_goals", ["year_month"])
    op.create_index(
        "ix_monthly_goals_store_month",
        "monthly_goals",
        ["store_id", "year_month"],
    )

    # ========================================
    # QUALITY AUDITS
    # ========================================
    op.create_table(
        "quality_audits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("audit_date", sa.Date(), nullable=False),
        sa.Column("auditor_id", sa.Integer(), nullable=False),
        sa.Column("checklist", sa.JSON(), nullable=False),  # JSON with checklist items
        sa.Column("overall_score", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("photos", sa.JSON(), nullable=True),  # JSON array of photo URLs
        sa.Column("status", sa.String(length=20), nullable=False, server_default="completed"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["store_id"],
            ["stores.id"],
            name="fk_quality_audits_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["auditor_id"],
            ["users.id"],
            name="fk_quality_audits_auditor",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "store_id", "audit_date",
            name="uq_quality_audits_store_date"
        ),
    )

    # Indexes for quality_audits
    op.create_index("ix_quality_audits_store_id", "quality_audits", ["store_id"])
    op.create_index("ix_quality_audits_audit_date", "quality_audits", ["audit_date"])
    op.create_index("ix_quality_audits_auditor_id", "quality_audits", ["auditor_id"])
    op.create_index("ix_quality_audits_overall_score", "quality_audits", ["overall_score"])
    op.create_index(
        "ix_quality_audits_store_date_range",
        "quality_audits",
        ["store_id", "audit_date"],
    )

    # ========================================
    # METRICS CACHE
    # ========================================
    op.create_table(
        "metrics_cache",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("metric_type", sa.String(length=50), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=True),  # Nullable for global metrics
        sa.Column("date_key", sa.String(length=20), nullable=False),  # e.g., "2026-01", "2026-W04"
        sa.Column("data", sa.JSON(), nullable=False),  # JSON with metric data
        sa.Column(
            "calculated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["store_id"],
            ["stores.id"],
            name="fk_metrics_cache_store",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "metric_type", "store_id", "date_key",
            name="uq_metrics_cache_type_store_date"
        ),
    )

    # Indexes for metrics_cache
    op.create_index("ix_metrics_cache_metric_type", "metrics_cache", ["metric_type"])
    op.create_index("ix_metrics_cache_store_id", "metrics_cache", ["store_id"])
    op.create_index("ix_metrics_cache_date_key", "metrics_cache", ["date_key"])
    op.create_index("ix_metrics_cache_expires_at", "metrics_cache", ["expires_at"])
    op.create_index(
        "ix_metrics_cache_type_store",
        "metrics_cache",
        ["metric_type", "store_id"],
    )
    op.create_index(
        "ix_metrics_cache_lookup",
        "metrics_cache",
        ["metric_type", "store_id", "date_key"],
    )


def downgrade() -> None:
    """Drop Phase 5 tables."""

    # Drop indexes first
    op.drop_index("ix_metrics_cache_lookup", "metrics_cache")
    op.drop_index("ix_metrics_cache_type_store", "metrics_cache")
    op.drop_index("ix_metrics_cache_expires_at", "metrics_cache")
    op.drop_index("ix_metrics_cache_date_key", "metrics_cache")
    op.drop_index("ix_metrics_cache_store_id", "metrics_cache")
    op.drop_index("ix_metrics_cache_metric_type", "metrics_cache")

    op.drop_index("ix_quality_audits_store_date_range", "quality_audits")
    op.drop_index("ix_quality_audits_overall_score", "quality_audits")
    op.drop_index("ix_quality_audits_auditor_id", "quality_audits")
    op.drop_index("ix_quality_audits_audit_date", "quality_audits")
    op.drop_index("ix_quality_audits_store_id", "quality_audits")

    op.drop_index("ix_monthly_goals_store_month", "monthly_goals")
    op.drop_index("ix_monthly_goals_year_month", "monthly_goals")
    op.drop_index("ix_monthly_goals_department", "monthly_goals")
    op.drop_index("ix_monthly_goals_store_id", "monthly_goals")

    # Drop tables
    op.drop_table("metrics_cache")
    op.drop_table("quality_audits")
    op.drop_table("monthly_goals")
