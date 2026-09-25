"""tool receipts: material_request_tools.employee_id + material_tool_receipts

Vincula cada linha de ferramenta a um funcionário (destinatário) e cria a tabela
de recebimentos assinados (o "card" do Controle de EPIs, uma vez recebido).

Revision ID: 20260814_117
Revises: 20260814_116
Create Date: 2026-08-14
"""

import sqlalchemy as sa
from alembic import op

revision = "20260814_117"
down_revision = "20260814_116"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_request_tools",
        sa.Column("employee_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_material_request_tools_employee_id",
        "material_request_tools",
        "employees",
        ["employee_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_material_request_tools_employee_id",
        "material_request_tools",
        ["employee_id"],
    )

    op.create_table(
        "material_tool_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("signature_base64", sa.Text(), nullable=False),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("confirmed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["request_id"], ["material_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["confirmed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "request_id", "employee_id", name="uq_tool_receipt_request_employee"
        ),
    )
    op.create_index(
        "ix_material_tool_receipts_request_id", "material_tool_receipts", ["request_id"]
    )
    op.create_index(
        "ix_material_tool_receipts_employee_id", "material_tool_receipts", ["employee_id"]
    )


def downgrade() -> None:
    op.drop_table("material_tool_receipts")
    op.drop_index("ix_material_request_tools_employee_id", table_name="material_request_tools")
    op.drop_constraint(
        "fk_material_request_tools_employee_id", "material_request_tools", type_="foreignkey"
    )
    op.drop_column("material_request_tools", "employee_id")
