"""add security_film department

Revision ID: 20260621_086
Revises: 20260616_085
Create Date: 2026-06-21

Contexto:
  O departamento "Película de Segurança" (security_film) foi adicionado ao enum
  ServiceDepartment. As CHECK constraints de `department` em service_orders e
  services precisam aceitar o novo valor, senão criar O.S./serviço com
  department='security_film' causa IntegrityError (500).

  Além disso, os serviços de película de segurança hoje vivem como
  department='film' + category='pelicula_seguranca'. Esta migration os move para
  o novo departamento próprio (HML-186).
"""

from alembic import op

revision = "20260621_086"
down_revision = "20260616_085"
branch_labels = None
depends_on = None

_DEPTS_NEW = "('film', 'security_film', 'ppf', 'bodywork', 'vn', 'vd', 'vu', 'workshop')"
_DEPTS_OLD = "('film', 'ppf', 'bodywork', 'vn', 'vd', 'vu', 'workshop')"


def upgrade() -> None:
    # 1. Recria as CHECK constraints incluindo 'security_film'
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_department")
    op.execute(
        "ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_department "
        f"CHECK (department IN {_DEPTS_NEW})"
    )

    op.execute("ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_department")
    op.execute(
        "ALTER TABLE services ADD CONSTRAINT ck_services_department "
        f"CHECK (department IN {_DEPTS_NEW})"
    )

    # 2. Migra serviços de película de segurança para o novo departamento
    op.execute(
        "UPDATE services SET department = 'security_film' "
        "WHERE category = 'pelicula_seguranca' AND department = 'film'"
    )


def downgrade() -> None:
    # Reverte os serviços migrados para o departamento 'film'
    op.execute(
        "UPDATE services SET department = 'film' "
        "WHERE category = 'pelicula_seguranca' AND department = 'security_film'"
    )

    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_department")
    op.execute(
        "ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_department "
        f"CHECK (department IN {_DEPTS_OLD})"
    )

    op.execute("ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_department")
    op.execute(
        "ALTER TABLE services ADD CONSTRAINT ck_services_department "
        f"CHECK (department IN {_DEPTS_OLD})"
    )
