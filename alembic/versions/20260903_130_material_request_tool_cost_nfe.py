"""material request tool cost/nfe: material_request_tools.cost, nfe_number

Adiciona custo e número de NF por linha de ferramenta do pedido, espelhando
FilmRoll.cost/nfe_number (inventory). Nullable: ferramentas antigas foram
lançadas sem esses valores; a obrigatoriedade para pedidos novos é validada
no Pydantic (MaterialRequestToolCreate), não no banco.

Revision ID: 20260903_130
Revises: 20260901_129
Create Date: 2026-09-03
"""

import sqlalchemy as sa

from alembic import op

revision = "20260903_130"
down_revision = "20260901_129"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_request_tools",
        sa.Column("cost", sa.Numeric(10, 2), nullable=True),
    )
    op.add_column(
        "material_request_tools",
        sa.Column("nfe_number", sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("material_request_tools", "nfe_number")
    op.drop_column("material_request_tools", "cost")
