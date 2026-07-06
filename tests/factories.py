"""
Test factories for AEMS models.

Plain async helper functions that create model instances with sensible defaults
and accept keyword overrides.  Each function commits to the provided session
and returns the refreshed object so that auto-generated fields (id, created_at,
etc.) are immediately available.

Usage example::

    store = await create_store(db_session, code="LJ05", name="Loja Cinco")
    user  = await create_user(db_session, store=store, role="user")
"""

import itertools

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.modules.auth.models import User
from app.modules.brands.models import Brand
from app.modules.consultants.models import Consultant
from app.modules.dealerships.models import Dealership
from app.modules.employees.models import Employee
from app.modules.services.models import Service
from app.modules.stores.models import Store

# ---------------------------------------------------------------------------
# Sequence generators – provide unique defaults so multiple calls in one test
# session never collide on unique-constrained columns.
# ---------------------------------------------------------------------------
_store_seq = itertools.count(50)       # start at 50 to avoid clashing with conftest
_user_seq = itertools.count(50)
_employee_seq = itertools.count(1)
_service_seq = itertools.count(1)
_dealership_seq = itertools.count(1)
_consultant_seq = itertools.count(1)
_brand_seq = itertools.count(1)


# ---------------------------------------------------------------------------
# Brand
# ---------------------------------------------------------------------------

async def create_brand(db: AsyncSession, **overrides) -> Brand:
    """
    Create and persist a Brand instance.

    Default values:
    - name: "Marca <N>"
    - code: "marca<N>"
    - is_active: True
    """
    n = next(_brand_seq)
    defaults: dict = {
        "name": f"Marca {n}",
        "code": f"marca{n}",
        "is_active": True,
    }
    defaults.update(overrides)

    brand = Brand(**defaults)
    db.add(brand)
    await db.commit()
    await db.refresh(brand)
    return brand


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

async def create_store(
    db: AsyncSession,
    brand: Brand | None = None,
    **overrides,
) -> Store:
    """
    Create and persist a Store instance.

    Default values:
    - code: auto-generated unique code such as "LJ50", "LJ51", …
    - name: "Loja Teste <N>"
    - address: "Rua dos Testes, <N>"
    - phone: "11900000000"
    - is_active: True
    - brand_id: brand.id when *brand* is provided; creates a brand automatically if
                neither brand nor brand_id is provided in overrides

    Any keyword argument is passed directly to the Store constructor,
    overriding the default for that field.
    """
    n = next(_store_seq)

    # Auto-create a brand if none provided
    if brand is None and "brand_id" not in overrides:
        brand = await create_brand(db, name=f"Auto Brand {n}", code=f"auto{n}")

    defaults: dict = {
        "code": f"LJ{n:02d}",
        "name": f"Loja Teste {n}",
        "address": f"Rua dos Testes, {n}",
        "phone": "11900000000",
        "is_active": True,
        "brand_id": brand.id if brand is not None else None,
    }
    defaults.update(overrides)

    store = Store(**defaults)
    db.add(store)
    await db.commit()
    await db.refresh(store)
    return store


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

async def create_user(
    db: AsyncSession,
    store: Store | None = None,
    role: str = "user",
    **overrides,
) -> User:
    """
    Create and persist a User instance.

    Default values:
    - email: "user<N>@test.com"
    - hashed_password: hash of "Test@1234"
    - full_name: "Test User <N>"
    - role: "user" (pass role= to override)
    - store_id: store.id when *store* is provided, else None
    - is_active: True
    - must_change_password: False

    Pass ``store=<Store>`` to set the store_id foreign key automatically.
    """
    n = next(_user_seq)
    defaults: dict = {
        "email": f"user{n}@test.com",
        "hashed_password": get_password_hash("Test@1234"),
        "full_name": f"Test User {n}",
        "role": role,
        "store_id": store.id if store is not None else None,
        "is_active": True,
        "must_change_password": False,
    }
    defaults.update(overrides)

    user = User(**defaults)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Employee
# ---------------------------------------------------------------------------

async def create_employee(
    db: AsyncSession,
    store: Store | None = None,
    **overrides,
) -> Employee:
    """
    Create and persist an Employee instance.

    Default values:
    - name: "Funcionário <N>"
    - store_id: store.id when *store* is provided (required unless passed via overrides)
    - department: "film"
    - position: "Instalador"
    - is_active: True

    Raises ValueError if neither *store* nor ``store_id`` is provided.
    """
    n = next(_employee_seq)
    if store is None and "store_id" not in overrides:
        raise ValueError("create_employee requires either store= or store_id= to be provided.")

    defaults: dict = {
        "name": f"Funcionário {n}",
        "store_id": store.id if store is not None else None,
        "department": "film",
        "position": "Instalador",
        "is_active": True,
    }
    defaults.update(overrides)

    employee = Employee(**defaults)
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

async def create_service(
    db: AsyncSession,
    brand: Brand | None = None,
    **overrides,
) -> Service:
    """
    Create and persist a Service instance.

    Default values:
    - name: "Serviço <N>"
    - department: "film"
    - description: "Descrição do serviço <N>"
    - base_price: 100.00
    - is_active: True
    - brand_id: brand.id when *brand* is provided; creates a brand automatically if
                neither brand nor brand_id is provided in overrides
    """
    n = next(_service_seq)

    # Auto-create a brand if none provided
    if brand is None and "brand_id" not in overrides:
        brand = await create_brand(db, name=f"Service Brand {n}", code=f"svc{n}")

    defaults: dict = {
        "name": f"Serviço {n}",
        "department": "film",
        "description": f"Descrição do serviço {n}",
        "base_price": 100.00,
        "is_active": True,
        "brand_id": brand.id if brand is not None else None,
    }
    defaults.update(overrides)

    service = Service(**defaults)
    db.add(service)
    await db.commit()
    await db.refresh(service)
    return service


# ---------------------------------------------------------------------------
# Dealership
# ---------------------------------------------------------------------------

async def create_dealership(
    db: AsyncSession,
    store: Store | None = None,
    **overrides,
) -> Dealership:
    """
    Create and persist a Dealership instance.

    Default values:
    - name: "Concessionária <N>"
    - store_id: store.id when *store* is provided
    - brand: "Toyota"
    - address: "Av. Concessionária, <N>"
    - is_active: True

    Raises ValueError if neither *store* nor ``store_id`` is provided.
    """
    n = next(_dealership_seq)
    if store is None and "store_id" not in overrides:
        raise ValueError(
            "create_dealership requires either store= or store_id= to be provided."
        )

    defaults: dict = {
        "name": f"Concessionária {n}",
        "store_id": store.id if store is not None else None,
        "brand": "Toyota",
        "address": f"Av. Concessionária, {n}",
        "is_active": True,
    }
    defaults.update(overrides)

    dealership = Dealership(**defaults)
    db.add(dealership)
    await db.commit()
    await db.refresh(dealership)
    return dealership


# ---------------------------------------------------------------------------
# Consultant
# ---------------------------------------------------------------------------

async def create_consultant(
    db: AsyncSession,
    store: Store | None = None,
    dealership: Dealership | None = None,
    **overrides,
) -> Consultant:
    """
    Create and persist a Consultant instance.

    Default values:
    - name: "Consultor <N>"
    - store_id: store.id when *store* is provided
    - dealership_id: dealership.id when *dealership* is provided
    - phone: "11900000000"
    - email: "consultor<N>@concessionaria.com"
    - is_active: True

    Raises ValueError if the required foreign keys are not resolvable.
    """
    n = next(_consultant_seq)

    if store is None and "store_id" not in overrides:
        raise ValueError(
            "create_consultant requires either store= or store_id= to be provided."
        )
    if dealership is None and "dealership_id" not in overrides:
        raise ValueError(
            "create_consultant requires either dealership= or dealership_id= to be provided."
        )

    defaults: dict = {
        "name": f"Consultor {n}",
        "store_id": store.id if store is not None else None,
        "dealership_id": dealership.id if dealership is not None else None,
        "phone": "11900000000",
        "email": f"consultor{n}@concessionaria.com",
        "is_active": True,
    }
    defaults.update(overrides)

    consultant = Consultant(**defaults)
    db.add(consultant)
    await db.commit()
    await db.refresh(consultant)
    return consultant
