"""access_logs_user_fk_set_null

Revision ID: 038_access_logs_user_fk_set_null
Revises: 037_so_vehicle_model_id
Create Date: 2026-03-31 00:38:00.000000-03:00

Fix: access_logs.user_id FK lacked ON DELETE SET NULL, causing IntegrityError
when deleting users with login history.
"""

from alembic import op

revision = "038_access_logs_user_fk_set_null"
down_revision = "037_so_vehicle_model_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the existing FK (no ON DELETE clause) and re-add with SET NULL
    op.drop_constraint("access_logs_user_id_fkey", "access_logs", type_="foreignkey")
    op.create_foreign_key(
        "access_logs_user_id_fkey",
        "access_logs",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("access_logs_user_id_fkey", "access_logs", type_="foreignkey")
    op.create_foreign_key(
        "access_logs_user_id_fkey",
        "access_logs",
        "users",
        ["user_id"],
        ["id"],
    )
