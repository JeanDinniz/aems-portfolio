"""update_users_role_constraint

Revision ID: 042_update_users_role_constraint
Revises: 041_vehicle_models_unique_active_only
Create Date: 2026-04-06 10:00:00.000000-03:00

Remove os roles 'supervisor' e 'operator' da constraint ck_users_role.
O sistema agora usa apenas 'owner' e 'user'.
"""

from alembic import op

revision = "042_update_users_role_constraint"
down_revision = "041_vm_unique_active"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role")
    op.execute("ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role IN ('owner', 'user'))")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role")
    op.execute("ALTER TABLE users ADD CONSTRAINT ck_users_role CHECK (role IN ('owner', 'supervisor', 'operator'))")
