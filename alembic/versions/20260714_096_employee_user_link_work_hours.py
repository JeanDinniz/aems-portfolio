"""Ponto Eletrônico (1/3): vínculo User↔Employee e horário de trabalho.

employees.user_id (FK users, SET NULL, UNIQUE — vínculo 1:1): autoriza o
usuário a bater ponto pelo próprio login. work_start_time/work_end_time:
horário individual para os lembretes (null = default 08:00/18:00 no código).

Revision ID: 20260714_096
Revises: 20260713_095
Create Date: 2026-07-14
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260714_096"
down_revision = "20260713_095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("user_id", sa.Integer(), nullable=True))
    op.add_column("employees", sa.Column("work_start_time", sa.Time(), nullable=True))
    op.add_column("employees", sa.Column("work_end_time", sa.Time(), nullable=True))
    op.create_foreign_key(
        "fk_employees_user_id",
        "employees",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint("uq_employees_user_id", "employees", ["user_id"])


def downgrade() -> None:
    op.drop_constraint("uq_employees_user_id", "employees", type_="unique")
    op.drop_constraint("fk_employees_user_id", "employees", type_="foreignkey")
    op.drop_column("employees", "work_end_time")
    op.drop_column("employees", "work_start_time")
    op.drop_column("employees", "user_id")
