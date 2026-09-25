"""Testes de integração do módulo de Pedidos de Material.

Cobrem: criação de pedido gera bobina no Estoque (FilmRoll vinculada) + linhas
de ferramenta; filtros de loja/data; exclusão preserva a bobina (FK vira NULL);
escopo de galpão; e permissões por submódulo (403 sem material_requests).
"""

from datetime import UTC, date, datetime
from io import BytesIO

import pytest
from httpx import AsyncClient
from openpyxl import load_workbook
from sqlalchemy import select

from app.core.audit import AuditLog
from app.core.security import get_password_hash
from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_stores,
    access_profile_users,
)
from app.modules.auth.models import User
from app.modules.inventory.models import FilmConsumption, FilmRoll, FilmType
from app.modules.material_requests.models import MaterialRequest
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from tests.conftest import VALID_TEST_PASSWORD


async def _create_film_type(owner_client: AsyncClient, name: str = "Poliester Teste") -> int:
    resp = await owner_client.post(
        "/api/v1/film-types",
        json={
            "name": name,
            "department": "film",
            "yellow_threshold_meters": 6,
            "red_threshold_meters": 2,
            "available_tonalities": ["G05", "G20", "G35"],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _make_user_with_permission(
    db_session,
    store,
    *,
    email: str,
    sub_module: str = "material_requests",
    can_view: bool = True,
    can_edit: bool = True,
    can_delete: bool = True,
    is_galpon_profile: bool = False,
    hide_galpon_option: bool = False,
    link_store: bool = False,
) -> None:
    user = User(
        email=email,
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="Perm User",
        role="user",
        store_id=store.id,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    profile = AccessProfile(
        name=f"Perfil {email}",
        is_active=True,
        is_galpon_profile=is_galpon_profile,
        hide_galpon_option=hide_galpon_option,
    )
    db_session.add(profile)
    await db_session.flush()
    db_session.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="OPERACIONAL",
            sub_module=sub_module,
            can_view=can_view,
            can_edit=can_edit,
            can_delete=can_delete,
        )
    )
    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=user.id)
    )
    if link_store:
        await db_session.execute(
            access_profile_stores.insert().values(profile_id=profile.id, store_id=store.id)
        )
    await db_session.commit()


async def _login(client: AsyncClient, email: str) -> None:
    login = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": VALID_TEST_PASSWORD},
    )
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"


class TestCreateGeneratesRollAndTools:
    @pytest.mark.asyncio
    async def test_create_request_generates_roll_and_tools(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        ft_id = await _create_film_type(owner_client)

        resp = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "notes": "Pedido semanal",
                "film_lines": [
                    {
                        "film_type_id": ft_id,
                        "tonality": "G20",
                        "total_meters": 15,
                        "supplier": "Fornecedor X",
                        "nfe_number": "NF-123",
                        "cost": "250.00",
                    }
                ],
                "tool_lines": [
                    {
                        "name": "Espátula Bulldozer",
                        "quantity": 2,
                        "notes": "média",
                        "nfe_number": "NF-TOOL-1",
                        "cost": "35.00",
                    },
                    {
                        "name": "Borrifador",
                        "quantity": 1,
                        "nfe_number": "NF-TOOL-2",
                        "cost": "12.50",
                    },
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert len(body["film_items"]) == 1
        assert body["film_items"][0]["film_type_id"] == ft_id
        assert body["film_items"][0]["tonality"] == "G20"
        assert body["film_items"][0]["total_meters"] == 15
        assert len(body["tool_items"]) == 2
        assert {t["name"] for t in body["tool_items"]} == {"Espátula Bulldozer", "Borrifador"}
        by_name = {t["name"]: t for t in body["tool_items"]}
        assert by_name["Espátula Bulldozer"]["nfe_number"] == "NF-TOOL-1"
        assert by_name["Espátula Bulldozer"]["cost"] == "35.00"
        assert by_name["Borrifador"]["nfe_number"] == "NF-TOOL-2"
        assert by_name["Borrifador"]["cost"] == "12.50"

        # A bobina entrou no Estoque, vinculada ao pedido, com saldo cheio.
        roll = (
            await db_session.execute(
                select(FilmRoll).where(FilmRoll.material_request_id == body["id"])
            )
        ).scalar_one()
        assert roll.status == "em_estoque"
        assert roll.total_meters == 15
        assert roll.remaining_meters == 15
        assert roll.store_id == test_store.id

    @pytest.mark.asyncio
    async def test_create_rejects_empty_request(self, owner_client: AsyncClient, test_store):
        resp = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "film_lines": [],
                "tool_lines": [],
            },
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_create_rejects_tool_without_cost_or_nfe(
        self, owner_client: AsyncClient, test_store
    ):
        """cost e nfe_number são obrigatórios por linha de ferramenta (422 sem eles)."""
        sem_custo = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "tool_lines": [{"name": "Espátula", "quantity": 1, "nfe_number": "NF-1"}],
            },
        )
        assert sem_custo.status_code == 422, sem_custo.text

        sem_nf = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "tool_lines": [{"name": "Espátula", "quantity": 1, "cost": "10.00"}],
            },
        )
        assert sem_nf.status_code == 422, sem_nf.text

        # NF em branco (string vazia) também é rejeitada — não basta a chave existir.
        nf_vazia = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "tool_lines": [
                    {"name": "Espátula", "quantity": 1, "nfe_number": "", "cost": "10.00"}
                ],
            },
        )
        assert nf_vazia.status_code == 422, nf_vazia.text


class TestListingFilters:
    @pytest.mark.asyncio
    async def test_filters_by_store_and_date(
        self, owner_client: AsyncClient, test_store, second_store
    ):
        # test_store: dois pedidos em datas diferentes; second_store: um pedido.
        for req_date in ("2026-08-01", "2026-08-10"):
            r = await owner_client.post(
                "/api/v1/material-requests",
                json={
                    "store_id": test_store.id,
                    "request_date": req_date,
                    "tool_lines": [
                        {
                            "name": "Blue Max",
                            "quantity": 1,
                            "nfe_number": "NF-TESTE",
                            "cost": "10.00",
                        }
                    ],
                },
            )
            assert r.status_code == 201, r.text
        r = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": second_store.id,
                "request_date": "2026-08-05",
                "tool_lines": [
                    {"name": "Raspador", "quantity": 3, "nfe_number": "NF-TESTE", "cost": "10.00"}
                ],
            },
        )
        assert r.status_code == 201, r.text

        # Filtro por loja
        resp = await owner_client.get(f"/api/v1/material-requests?store_id={test_store.id}")
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert len(items) == 2
        assert all(i["store_id"] == test_store.id for i in items)

        # Filtro por intervalo de datas (só o de 10/08)
        resp = await owner_client.get(
            f"/api/v1/material-requests?store_id={test_store.id}&date_from=2026-08-05"
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["request_date"] == "2026-08-10"

    @pytest.mark.asyncio
    async def test_export_excel_ok(self, owner_client: AsyncClient, test_store):
        r = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "tool_lines": [
                    {"name": "Blue Max", "quantity": 1, "nfe_number": "NF-TESTE", "cost": "10.00"}
                ],
            },
        )
        assert r.status_code == 201, r.text
        resp = await owner_client.get("/api/v1/material-requests/export/excel")
        assert resp.status_code == 200, resp.text
        assert "spreadsheetml" in resp.headers["content-type"]
        assert resp.content[:2] == b"PK"  # xlsx é um zip

        # Linha 1 = título com o nome da loja; linha 2 = cabeçalho com datas dd/mm/aa.
        wb = load_workbook(BytesIO(resp.content))
        ws = wb.active
        assert ws["A1"].value == test_store.name
        header = [ws.cell(row=2, column=c).value for c in range(1, ws.max_column + 1)]
        assert header[0] == "Item"
        assert "14/08/26" in header  # 2026-08-14 com ano de 2 dígitos
        assert ws.freeze_panes == "B3"


class TestCancelRequest:
    @pytest.mark.asyncio
    async def test_cancel_request_removes_unused_rolls(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        """Cancelar (com motivo) mantém o pedido visível como cancelado e apaga a bobina não usada."""
        ft_id = await _create_film_type(owner_client, name="PS4 Teste")
        resp = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "film_lines": [{"film_type_id": ft_id, "tonality": "G05", "total_meters": 10}],
            },
        )
        assert resp.status_code == 201, resp.text
        req_id = resp.json()["id"]
        roll_id = resp.json()["film_items"][0]["film_roll_id"]

        cancel = await owner_client.request(
            "DELETE",
            f"/api/v1/material-requests/{req_id}",
            json={"cancellation_reason": "Lançado errado"},
        )
        assert cancel.status_code == 200, cancel.text

        # Pedido CONTINUA visível, marcado como cancelado, com o motivo
        detail = await owner_client.get(f"/api/v1/material-requests/{req_id}")
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["status"] == "cancelled"
        assert body["cancellation_reason"] == "Lançado errado"
        assert body["cancelled_at"] is not None

        # Bobina não usada foi removida do estoque
        db_session.expire_all()
        assert (await db_session.get(FilmRoll, roll_id)) is None

    @pytest.mark.asyncio
    async def test_cancel_tool_only_request_ok(self, owner_client: AsyncClient, test_store):
        """Pedido sem bobinas (só ferramenta) cancela normalmente (nada a remover do estoque)."""
        r = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "tool_lines": [
                    {"name": "Espátula", "quantity": 1, "nfe_number": "NF-TESTE", "cost": "10.00"}
                ],
            },
        )
        req_id = r.json()["id"]
        cancel = await owner_client.request(
            "DELETE",
            f"/api/v1/material-requests/{req_id}",
            json={"cancellation_reason": "duplicado"},
        )
        assert cancel.status_code == 200, cancel.text
        assert cancel.json()["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_cancel_requires_reason(self, owner_client: AsyncClient, test_store):
        r = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "tool_lines": [
                    {"name": "Blue Max", "quantity": 1, "nfe_number": "NF-TESTE", "cost": "10.00"}
                ],
            },
        )
        req_id = r.json()["id"]
        resp = await owner_client.request("DELETE", f"/api/v1/material-requests/{req_id}", json={})
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_cancel_blocked_when_roll_used(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        """Se alguma bobina do pedido já foi usada em carros, o cancelamento é bloqueado (409)."""
        ft_id = await _create_film_type(owner_client, name="PS5 Teste")
        resp = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "film_lines": [{"film_type_id": ft_id, "tonality": "G20", "total_meters": 10}],
            },
        )
        req_id = resp.json()["id"]
        roll_id = resp.json()["film_items"][0]["film_roll_id"]

        db_session.add(
            FilmConsumption(
                film_roll_id=roll_id,
                service_order_item_id=None,
                meters_consumed=4,
                kind="consumo",
            )
        )
        await db_session.commit()

        cancel = await owner_client.request(
            "DELETE",
            f"/api/v1/material-requests/{req_id}",
            json={"cancellation_reason": "tentativa"},
        )
        assert cancel.status_code == 409, cancel.text
        db_session.expire_all()
        req = await db_session.get(MaterialRequest, req_id)
        assert req.status == "active"
        assert (await db_session.get(FilmRoll, roll_id)) is not None


class TestGalponScope:
    @pytest.mark.asyncio
    async def test_hide_galpon_user_does_not_see_galpon_requests(
        self, owner_client: AsyncClient, client: AsyncClient, db_session, test_store
    ):
        # Owner cria um pedido normal e um de galpão na mesma loja.
        for is_galpon in (False, True):
            r = await owner_client.post(
                "/api/v1/material-requests",
                json={
                    "store_id": test_store.id,
                    "request_date": "2026-08-14",
                    "is_galpon": is_galpon,
                    "tool_lines": [
                        {
                            "name": "Blue Max",
                            "quantity": 1,
                            "nfe_number": "NF-TESTE",
                            "cost": "10.00",
                        }
                    ],
                },
            )
            assert r.status_code == 201, r.text

        await _make_user_with_permission(
            db_session,
            test_store,
            email="hidegalpon@test.com",
            hide_galpon_option=True,
        )
        await _login(client, "hidegalpon@test.com")
        resp = await client.get("/api/v1/material-requests")
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["is_galpon"] is False


class TestPermissions:
    @pytest.mark.asyncio
    async def test_user_without_permission_is_forbidden(
        self, client: AsyncClient, db_session, test_store
    ):
        await _make_user_with_permission(
            db_session,
            test_store,
            email="noperm@test.com",
            sub_module="scheduling",  # não é material_requests
        )
        await _login(client, "noperm@test.com")
        assert (await client.get("/api/v1/material-requests")).status_code == 403
        create = await client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2026-08-14",
                "tool_lines": [
                    {"name": "X", "quantity": 1, "nfe_number": "NF-TESTE", "cost": "10.00"}
                ],
            },
        )
        assert create.status_code == 403


class TestGetRequestScope:
    """#9 — GET /material-requests/{id} respeita escopo de loja (IDOR fechado).

    Antes: get_request não recebia user nem filtrava loja — qualquer usuário com
    material_requests:can_view lia pedido (custos/NF/fornecedor) de OUTRA loja.
    """

    async def _create_request_in_store(self, owner_client: AsyncClient, store) -> int:
        ft_id = await _create_film_type(owner_client)
        created = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": store.id,
                "request_date": "2026-08-14",
                "film_lines": [
                    {
                        "film_type_id": ft_id,
                        "tonality": "G20",
                        "total_meters": 10,
                        "supplier": "Fornecedor X",
                        "nfe_number": "NF-1",
                        "cost": "100.00",
                    }
                ],
            },
        )
        assert created.status_code == 201, created.text
        return created.json()["id"]

    @pytest.mark.asyncio
    async def test_get_request_de_outra_loja_retorna_404(
        self, owner_client: AsyncClient, db_session, test_store, second_store
    ):
        req_id = await self._create_request_in_store(owner_client, test_store)

        # Atacante: tem material_requests:can_view, mas está na second_store
        await _make_user_with_permission(
            db_session, second_store, email="atacante@loja.com", link_store=True
        )
        await _login(owner_client, "atacante@loja.com")  # troca o ator no mesmo client

        resp = await owner_client.get(f"/api/v1/material-requests/{req_id}")
        # require_resource_access levanta 404 de propósito (não vaza existência
        # do recurso entre lojas) — mais seguro que 403.
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_request_como_owner_ok(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req_id = await self._create_request_in_store(owner_client, test_store)
        resp = await owner_client.get(f"/api/v1/material-requests/{req_id}")
        assert resp.status_code == 200


class TestRollYield:
    @pytest.mark.asyncio
    async def test_yield_counts_distinct_cars_per_roll(
        self, owner_client: AsyncClient, db_session, test_store, test_brand
    ):
        # Bobina de 15m
        ft = FilmType(name="Insuline Yield", department="film", available_tonalities=["G20"])
        db_session.add(ft)
        await db_session.flush()
        roll = FilmRoll(
            store_id=test_store.id,
            film_type_id=ft.id,
            tonality="G20",
            total_meters=15,
            remaining_meters=5,
            receipt_date=date(2026, 8, 1),
            status="em_uso",
        )
        db_session.add(roll)
        await db_session.flush()
        svc = Service(name="Peli Yield", department="film", base_price=0, brand_id=test_brand.id)
        db_session.add(svc)
        await db_session.flush()

        now = datetime(2026, 8, 5, 12, 0, tzinfo=UTC)
        # 3 O.S. consumindo a mesma bobina; a 3ª repete a placa → 2 carros distintos
        for plate in ("ABC1D23", "XYZ9W87", "ABC1D23"):
            so = ServiceOrder(
                store_id=test_store.id,
                vehicle_plate=plate,
                department="film",
                entry_time=now,
                status="completed",
            )
            db_session.add(so)
            await db_session.flush()
            item = ServiceOrderItem(
                service_order_id=so.id,
                service_id=svc.id,
                quantity=1,
                unit_price=0,
                film_roll_id=roll.id,
                film_type_id=ft.id,
            )
            db_session.add(item)
            await db_session.flush()
            db_session.add(
                FilmConsumption(
                    film_roll_id=roll.id,
                    service_order_item_id=item.id,
                    meters_consumed=3,
                    kind="consumo",
                    created_at=now,
                )
            )
        await db_session.commit()

        resp = await owner_client.get(
            f"/api/v1/material-requests/roll-yield?store_id={test_store.id}"
        )
        assert resp.status_code == 200, resp.text
        grp = next(g for g in resp.json()["items"] if g["film_type_id"] == ft.id)
        assert grp["tonality"] == "G20"
        assert grp["roll_count"] == 1
        assert grp["rolls"][0]["cars"] == 2  # placas distintas (ABC1D23, XYZ9W87)
        assert grp["rolls"][0]["total_meters"] == 15
        assert grp["total_cars"] == 2
        assert grp["avg_cars"] == 2.0


class TestRollServiceOrders:
    @pytest.mark.asyncio
    async def test_drilldown_lists_cars_of_roll(
        self, owner_client: AsyncClient, db_session, test_store, test_brand
    ):
        """Drill-down: os carros de uma bobina com placa, serviço (WP1), instalador e metros."""
        from app.modules.employees.models import Employee
        from app.modules.service_orders.models import ServiceOrderWorker

        ft = FilmType(name="Insuline Drill", department="film", available_tonalities=["G20"])
        db_session.add(ft)
        await db_session.flush()
        roll = FilmRoll(
            store_id=test_store.id,
            film_type_id=ft.id,
            tonality="G20",
            total_meters=15,
            remaining_meters=11,
            receipt_date=date(2026, 8, 1),
            status="em_uso",
        )
        db_session.add(roll)
        await db_session.flush()
        svc = Service(
            name="Película WP1", code="WP1", department="film", base_price=0, brand_id=test_brand.id
        )
        emp = Employee(name="Instalador Drill", store_id=test_store.id, is_active=True)
        db_session.add_all([svc, emp])
        await db_session.flush()

        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="DRL1A23",
            department="film",
            entry_time=datetime(2026, 8, 5, 12, 0, tzinfo=UTC),
            service_date=date(2026, 8, 5),
            status="completed",
        )
        db_session.add(so)
        await db_session.flush()
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=svc.id,
            quantity=1,
            unit_price=0,
            film_roll_id=roll.id,
            film_type_id=ft.id,
        )
        db_session.add(item)
        await db_session.flush()
        db_session.add_all(
            [
                ServiceOrderWorker(service_order_id=so.id, employee_id=emp.id),
                FilmConsumption(
                    film_roll_id=roll.id,
                    service_order_item_id=item.id,
                    meters_consumed=4,
                    kind="consumo",
                ),
            ]
        )
        await db_session.commit()

        resp = await owner_client.get(f"/api/v1/material-requests/roll/{roll.id}/service-orders")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["film_roll_id"] == roll.id
        assert len(body["rows"]) == 1
        row = body["rows"][0]
        assert row["vehicle_plate"] == "DRL1A23"
        assert row["service_code"] == "WP1"
        assert row["meters_consumed"] == 4
        assert "Instalador Drill" in row["installers"]

    @pytest.mark.asyncio
    async def test_drilldown_empty_for_unused_roll(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        ft = FilmType(name="Insuline Empty", department="film", available_tonalities=["G20"])
        db_session.add(ft)
        await db_session.flush()
        roll = FilmRoll(
            store_id=test_store.id,
            film_type_id=ft.id,
            tonality="G20",
            total_meters=15,
            remaining_meters=15,
            receipt_date=date(2026, 8, 1),
            status="em_estoque",
        )
        db_session.add(roll)
        await db_session.commit()

        resp = await owner_client.get(f"/api/v1/material-requests/roll/{roll.id}/service-orders")
        assert resp.status_code == 200, resp.text
        assert resp.json()["rows"] == []


class TestUpdateRequest:
    """Edição de pedido lançado com reconcílio de bobinas + rastro na Auditoria."""

    async def _create_request(
        self, owner_client: AsyncClient, store, *, meters: float = 10
    ) -> dict:
        ft_id = await _create_film_type(owner_client, name=f"Edit Teste {meters}")
        resp = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": store.id,
                "request_date": "2026-09-01",
                "notes": "original",
                "film_lines": [
                    {
                        "film_type_id": ft_id,
                        "tonality": "G20",
                        "total_meters": meters,
                        "nfe_number": "NF-ORIG",
                    }
                ],
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        body["_film_type_id"] = ft_id
        return body

    @pytest.mark.asyncio
    async def test_edit_simple_fields_sets_edited_and_audits(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req = await self._create_request(owner_client, test_store)
        req_id = req["id"]

        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={"notes": "corrigido", "request_date": "2026-09-02"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["notes"] == "corrigido"
        assert body["request_date"] == "2026-09-02"
        assert body["edited_at"] is not None
        assert body["edited_by_user_id"] is not None
        assert body["edited_by_name"]

        db_session.expire_all()
        req_row = await db_session.get(MaterialRequest, req_id)
        assert req_row.edited_at is not None

        audit = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.resource_type == "material_request",
                        AuditLog.resource_id == req_id,
                        AuditLog.action == "update",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(audit) == 1
        entry = audit[0]
        assert entry.old_value["notes"] == "original"
        assert entry.new_value["notes"] == "corrigido"

    @pytest.mark.asyncio
    async def test_edit_roll_meters_without_consumption_ok(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        roll_id = req["film_items"][0]["film_roll_id"]

        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={
                "film_lines": [
                    {
                        "film_roll_id": roll_id,
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G35",
                        "total_meters": 25,
                        "nfe_number": "NF-NOVA",
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        item = resp.json()["film_items"][0]
        assert item["total_meters"] == 25
        assert item["tonality"] == "G35"
        assert item["nfe_number"] == "NF-NOVA"

        db_session.expire_all()
        roll = await db_session.get(FilmRoll, roll_id)
        assert float(roll.total_meters) == 25
        assert float(roll.remaining_meters) == 25  # sem consumo → saldo acompanha

    @pytest.mark.asyncio
    async def test_edit_roll_meters_blocked_when_consumed(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        roll_id = req["film_items"][0]["film_roll_id"]

        db_session.add(
            FilmConsumption(
                film_roll_id=roll_id,
                service_order_item_id=None,
                meters_consumed=4,
                kind="consumo",
            )
        )
        await db_session.commit()

        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={
                "film_lines": [
                    {
                        "film_roll_id": roll_id,
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G20",
                        "total_meters": 99,
                        "nfe_number": "NF-ORIG",
                    }
                ]
            },
        )
        assert resp.status_code == 409, resp.text
        db_session.expire_all()
        roll = await db_session.get(FilmRoll, roll_id)
        assert float(roll.total_meters) == 10  # inalterada

    @pytest.mark.asyncio
    async def test_edit_tonality_allowed_even_when_consumed(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        """Metros/tipo travam com consumo, mas tonalidade/NF continuam editáveis."""
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        roll_id = req["film_items"][0]["film_roll_id"]

        db_session.add(
            FilmConsumption(
                film_roll_id=roll_id,
                service_order_item_id=None,
                meters_consumed=4,
                kind="consumo",
            )
        )
        await db_session.commit()

        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={
                "film_lines": [
                    {
                        "film_roll_id": roll_id,
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G05",
                        "total_meters": 10,
                        "nfe_number": "NF-CORRIGIDA",
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        item = resp.json()["film_items"][0]
        assert item["tonality"] == "G05"
        assert item["nfe_number"] == "NF-CORRIGIDA"

    @pytest.mark.asyncio
    async def test_add_and_remove_film_line(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        roll_id = req["film_items"][0]["film_roll_id"]

        # Adiciona uma segunda linha (sem film_roll_id) e mantém a primeira.
        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={
                "film_lines": [
                    {
                        "film_roll_id": roll_id,
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G20",
                        "total_meters": 10,
                        "nfe_number": "NF-ORIG",
                    },
                    {
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G50",
                        "total_meters": 5,
                        "nfe_number": "NF-EXTRA",
                    },
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert len(resp.json()["film_items"]) == 2

        # Agora remove a bobina original (só a extra fica).
        new_roll_id = next(
            it["film_roll_id"] for it in resp.json()["film_items"] if it["film_roll_id"] != roll_id
        )
        resp2 = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={
                "film_lines": [
                    {
                        "film_roll_id": new_roll_id,
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G50",
                        "total_meters": 5,
                        "nfe_number": "NF-EXTRA",
                    }
                ]
            },
        )
        assert resp2.status_code == 200, resp2.text
        assert len(resp2.json()["film_items"]) == 1
        db_session.expire_all()
        assert (await db_session.get(FilmRoll, roll_id)) is None  # removida do estoque

    @pytest.mark.asyncio
    async def test_remove_film_line_blocked_when_consumed(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        roll_id = req["film_items"][0]["film_roll_id"]

        db_session.add(
            FilmConsumption(
                film_roll_id=roll_id,
                service_order_item_id=None,
                meters_consumed=4,
                kind="consumo",
            )
        )
        await db_session.commit()

        # Payload vazio de películas = tentar remover a bobina consumida → 409.
        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={"film_lines": []},
        )
        assert resp.status_code == 409, resp.text
        db_session.expire_all()
        assert (await db_session.get(FilmRoll, roll_id)) is not None

    @pytest.mark.asyncio
    async def test_edit_cancelled_request_returns_409(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]

        cancel = await owner_client.request(
            "DELETE",
            f"/api/v1/material-requests/{req_id}",
            json={"cancellation_reason": "erro"},
        )
        assert cancel.status_code == 200, cancel.text

        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={"notes": "tentando editar cancelado"},
        )
        assert resp.status_code == 409, resp.text

    @pytest.mark.asyncio
    async def test_edit_planilha_request_returns_409(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        # Marca como histórico importado (source="planilha") direto no banco.
        row = await db_session.get(MaterialRequest, req_id)
        row.source = "planilha"
        await db_session.commit()

        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={"notes": "tentando editar histórico"},
        )
        assert resp.status_code == 409, resp.text

    @pytest.mark.asyncio
    async def test_edit_unknown_film_roll_returns_404(self, owner_client: AsyncClient, test_store):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={
                "film_lines": [
                    {
                        "film_roll_id": 999999,  # não pertence a este pedido
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G20",
                        "total_meters": 10,
                        "nfe_number": "NF-ORIG",
                    }
                ]
            },
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_edit_emptying_request_returns_422(self, owner_client: AsyncClient, test_store):
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        # Remove a única película (sem consumo, ok) e não há ferramenta → vazio → 422.
        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={"film_lines": [], "tool_lines": []},
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_noop_save_does_not_stamp_edited(
        self, owner_client: AsyncClient, db_session, test_store
    ):
        """Salvar sem mudar nada NÃO marca o pedido como editado nem gera auditoria."""
        req = await self._create_request(owner_client, test_store, meters=10)
        req_id = req["id"]
        roll_id = req["film_items"][0]["film_roll_id"]

        resp = await owner_client.patch(
            f"/api/v1/material-requests/{req_id}",
            json={
                "request_date": req["request_date"],
                "notes": req["notes"],
                "film_lines": [
                    {
                        "film_roll_id": roll_id,
                        "film_type_id": req["_film_type_id"],
                        "tonality": "G20",
                        "total_meters": 10,
                        "nfe_number": "NF-ORIG",
                    }
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["edited_at"] is None

        audit = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.resource_type == "material_request",
                        AuditLog.resource_id == req_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert audit == []
