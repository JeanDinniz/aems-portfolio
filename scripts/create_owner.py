import asyncio
import sys
import app.modules.auth.models  # noqa: F401
import app.modules.stores.models  # noqa: F401
import app.modules.employees.models  # noqa: F401
import app.modules.service_orders.models  # noqa: F401
from app.db.session import AsyncSessionLocal
from app.modules.auth.models import User
from app.core.security import get_password_hash


async def create_owner(email: str, password: str, full_name: str) -> None:
    async with AsyncSessionLocal() as db:
        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            full_name=full_name,
            role="owner",
            is_active=True,
            force_password_change=True,
        )
        db.add(user)
        await db.commit()
        print(f"Usuario '{email}' criado com sucesso!")


if __name__ == "__main__":
    email = sys.argv[1] if len(sys.argv) > 1 else "admin@example.com"
    password = sys.argv[2] if len(sys.argv) > 2 else "senha123"
    full_name = sys.argv[3] if len(sys.argv) > 3 else "Admin"
    asyncio.run(create_owner(email, password, full_name))
