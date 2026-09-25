"""Ponto Eletrônico (3/3): registros de ponto, web push e idempotência de lembrete.

time_clock_records: batidas com hora do servidor, data local materializada
(recorded_date, fuso America/Sao_Paulo), selfie e geolocalização.
web_push_subscriptions: assinaturas VAPID do PWA (endpoint único).
time_clock_reminders_sent: UNIQUE(employee, date, type) — lembrete 1x.

Revision ID: 20260714_098
Revises: 20260714_097
Create Date: 2026-07-14
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260714_098"
down_revision = "20260714_097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "time_clock_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=10), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("recorded_date", sa.Date(), nullable=False),
        sa.Column("latitude", sa.Numeric(9, 6), nullable=False),
        sa.Column("longitude", sa.Numeric(9, 6), nullable=False),
        sa.Column("accuracy_m", sa.Numeric(8, 2), nullable=True),
        sa.Column("distance_m", sa.Numeric(10, 2), nullable=True),
        sa.Column("is_within_radius", sa.Boolean(), nullable=True),
        sa.Column("photo_url", sa.String(length=500), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_time_clock_records_employee_id", "time_clock_records", ["employee_id"])
    op.create_index("ix_tcr_store_date", "time_clock_records", ["store_id", "recorded_date"])
    op.create_index("ix_tcr_employee_date", "time_clock_records", ["employee_id", "recorded_date"])

    op.create_table(
        "web_push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(length=1024), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index("ix_web_push_subscriptions_user_id", "web_push_subscriptions", ["user_id"])

    op.create_table(
        "time_clock_reminders_sent",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("reminder_date", sa.Date(), nullable=False),
        sa.Column("type", sa.String(length=10), nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "employee_id", "reminder_date", "type", name="uq_tc_reminder_emp_date_type"
        ),
    )
    op.create_index(
        "ix_time_clock_reminders_sent_employee_id",
        "time_clock_reminders_sent",
        ["employee_id"],
    )


def downgrade() -> None:
    op.drop_table("time_clock_reminders_sent")
    op.drop_table("web_push_subscriptions")
    op.drop_index("ix_tcr_employee_date", table_name="time_clock_records")
    op.drop_index("ix_tcr_store_date", table_name="time_clock_records")
    op.drop_index("ix_time_clock_records_employee_id", table_name="time_clock_records")
    op.drop_table("time_clock_records")
