"""004_phase4_hr_incidents

Revision ID: 004
Revises: 003_phase3_inventory
Create Date: 2026-01-27

Phase 4: Gestão de RH e Incidentes
- HR Occurrences (Ocorrências de RH)
- Incidents (Incidentes)
- Incident Comments (Comentários de Incidentes)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create Phase 4 tables."""

    # ========================================
    # HR OCCURRENCES
    # ========================================
    op.create_table(
        "occurrences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("occurrence_type", sa.String(length=20), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="low"),
        sa.Column("occurrence_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("reported_by_id", sa.Integer(), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("attachments", sa.JSON(), nullable=True),
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
            name="fk_occurrences_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["users.id"],
            name="fk_occurrences_employee",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reported_by_id"],
            ["users.id"],
            name="fk_occurrences_reported_by",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["acknowledged_by_id"],
            ["users.id"],
            name="fk_occurrences_acknowledged_by",
            ondelete="RESTRICT",
        ),
    )

    # Indexes for occurrences
    op.create_index("ix_occurrences_store_id", "occurrences", ["store_id"])
    op.create_index("ix_occurrences_employee_id", "occurrences", ["employee_id"])
    op.create_index(
        "ix_occurrences_occurrence_type", "occurrences", ["occurrence_type"]
    )
    op.create_index(
        "ix_occurrences_occurrence_date", "occurrences", ["occurrence_date"]
    )
    op.create_index(
        "ix_occurrences_acknowledged", "occurrences", ["acknowledged"]
    )
    # Composite index for common queries
    op.create_index(
        "ix_occurrences_store_employee",
        "occurrences",
        ["store_id", "employee_id"],
    )

    # ========================================
    # INCIDENTS
    # ========================================
    op.create_table(
        "incidents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("incident_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("incident_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("incident_time", sa.Time(), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("reported_by_id", sa.Integer(), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responsible_employee_id", sa.Integer(), nullable=True),
        sa.Column("service_order_id", sa.Integer(), nullable=True),
        sa.Column("vehicle_plate", sa.String(length=10), nullable=True),
        sa.Column("estimated_damage_value", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("actual_damage_value", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("resolved_by_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("photos", sa.JSON(), nullable=True),
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
            name="fk_incidents_store",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reported_by_id"],
            ["users.id"],
            name="fk_incidents_reported_by",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["responsible_employee_id"],
            ["users.id"],
            name="fk_incidents_responsible_employee",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["service_order_id"],
            ["service_orders.id"],
            name="fk_incidents_service_order",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_id"],
            ["users.id"],
            name="fk_incidents_resolved_by",
            ondelete="RESTRICT",
        ),
    )

    # Indexes for incidents
    op.create_index("ix_incidents_store_id", "incidents", ["store_id"])
    op.create_index("ix_incidents_incident_type", "incidents", ["incident_type"])
    op.create_index("ix_incidents_status", "incidents", ["status"])
    op.create_index("ix_incidents_incident_date", "incidents", ["incident_date"])
    op.create_index(
        "ix_incidents_responsible_employee_id", "incidents", ["responsible_employee_id"]
    )
    op.create_index(
        "ix_incidents_service_order_id", "incidents", ["service_order_id"]
    )
    # Composite indexes for common queries
    op.create_index(
        "ix_incidents_store_type",
        "incidents",
        ["store_id", "incident_type"],
    )
    op.create_index(
        "ix_incidents_store_status",
        "incidents",
        ["store_id", "status"],
    )

    # ========================================
    # INCIDENT COMMENTS
    # ========================================
    op.create_table(
        "incident_comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("incident_id", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("commented_by_id", sa.Integer(), nullable=False),
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
            ["incident_id"],
            ["incidents.id"],
            name="fk_incident_comments_incident",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["commented_by_id"],
            ["users.id"],
            name="fk_incident_comments_commented_by",
            ondelete="RESTRICT",
        ),
    )

    # Indexes for incident_comments
    op.create_index("ix_incident_comments_incident_id", "incident_comments", ["incident_id"])
    op.create_index("ix_incident_comments_created_at", "incident_comments", ["created_at"])


def downgrade() -> None:
    """Drop Phase 4 tables."""

    # Drop indexes first
    op.drop_index("ix_incident_comments_created_at", "incident_comments")
    op.drop_index("ix_incident_comments_incident_id", "incident_comments")

    op.drop_index("ix_incidents_store_status", "incidents")
    op.drop_index("ix_incidents_store_type", "incidents")
    op.drop_index("ix_incidents_service_order_id", "incidents")
    op.drop_index("ix_incidents_responsible_employee_id", "incidents")
    op.drop_index("ix_incidents_incident_date", "incidents")
    op.drop_index("ix_incidents_status", "incidents")
    op.drop_index("ix_incidents_incident_type", "incidents")
    op.drop_index("ix_incidents_store_id", "incidents")

    op.drop_index("ix_occurrences_store_employee", "occurrences")
    op.drop_index("ix_occurrences_acknowledged", "occurrences")
    op.drop_index("ix_occurrences_occurrence_date", "occurrences")
    op.drop_index("ix_occurrences_occurrence_type", "occurrences")
    op.drop_index("ix_occurrences_employee_id", "occurrences")
    op.drop_index("ix_occurrences_store_id", "occurrences")

    # Drop tables
    op.drop_table("incident_comments")
    op.drop_table("incidents")
    op.drop_table("occurrences")
