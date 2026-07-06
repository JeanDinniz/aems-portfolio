"""
Script para definir a foto placeholder de todas as O.S. migradas.

Uso:
  python scripts/fix_migration_photos.py <caminho_da_foto>

Exemplo:
  python scripts/fix_migration_photos.py "C:/Users/Jean/Pictures/carro.jpg"

O script faz upload da foto para o sistema e atualiza todas as O.S.
que ainda não têm foto real (foto placeholder ou sem foto).
"""
import asyncio
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import get_settings

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

API_URL = os.getenv("MIGRATION_API_URL", "https://aems.example.com")
OWNER_EMAIL = "admin@aems.com.br"
OWNER_PASSWORD = "Matteo@2026"

PLACEHOLDER_MARKERS = [
    "placeholder",
    "localhost:9000/aems/placeholder",
]


def is_placeholder(photos_json: str | None) -> bool:
    if not photos_json:
        return True
    try:
        urls = json.loads(photos_json)
        if not urls:
            return True
        url = urls[0]
        return any(marker in url for marker in PLACEHOLDER_MARKERS)
    except Exception:
        return True


async def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python scripts/fix_migration_photos.py <caminho_da_foto>")
        print("Exemplo: python scripts/fix_migration_photos.py C:/Users/Jean/carro.jpg")
        sys.exit(1)

    photo_path = pathlib.Path(sys.argv[1])
    if not photo_path.exists():
        print(f"ERRO: arquivo não encontrado: {photo_path}")
        sys.exit(1)

    suffix = photo_path.suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        print(f"ERRO: formato não suportado: {suffix}  (use jpg, jpeg, png ou webp)")
        sys.exit(1)

    content_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else f"image/{suffix[1:]}"

    print(f"Foto selecionada: {photo_path}")

    # ── 1. Login na API ───────────────────────────────────────────────────────
    print(f"\nAutenticando em {API_URL}...")
    async with httpx.AsyncClient(base_url=API_URL, timeout=30) as client:
        resp = await client.post(
            "/api/v1/auth/login",
            data={"username": OWNER_EMAIL, "password": OWNER_PASSWORD},
        )
        if resp.status_code != 200:
            print(f"ERRO no login: {resp.status_code} — {resp.text}")
            sys.exit(1)
        token = resp.json().get("access_token")
        print("  Login OK")

        # ── 2. Upload da foto ─────────────────────────────────────────────────
        print("\nFazendo upload da foto...")
        with open(photo_path, "rb") as f:
            files = {"file": (photo_path.name, f, content_type)}
            resp = await client.post(
                "/api/v1/upload/photo",
                files=files,
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code != 200:
            print(f"ERRO no upload: {resp.status_code} — {resp.text}")
            sys.exit(1)
        photo_url = resp.json()["url"]
        print(f"  Upload OK → {photo_url}")

    # ── 3. Atualizar O.S. no banco ────────────────────────────────────────────
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    print("\nAtualizando O.S. no banco de dados...")

    async with async_session() as session:
        result = await session.execute(
            text("SELECT id, photos FROM service_orders")
        )
        rows = result.fetchall()

        ids_to_update = [row.id for row in rows if is_placeholder(row.photos)]
        print(f"  O.S. com foto placeholder/vazia: {len(ids_to_update)}")

        if not ids_to_update:
            print("  Nenhuma O.S. para atualizar.")
            await engine.dispose()
            return

        new_photos = json.dumps([photo_url])
        await session.execute(
            text(
                "UPDATE service_orders SET photos = :photos "
                "WHERE id = ANY(:ids)"
            ),
            {"photos": new_photos, "ids": ids_to_update},
        )
        await session.commit()

    print(f"\n✓ {len(ids_to_update)} O.S. atualizadas com a foto: {photo_url}")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
