"""Testes de integração do módulo de EPI."""

import pytest

from app.modules.epi.constants import EntregaEPIStatus, PendenciaEstado
from app.modules.epi.models import EPI, CargoEPI, EntregaEPI


@pytest.mark.asyncio
async def test_models_persistem_e_relacionam(db_session, test_store, test_employee):
    """As 3 tabelas de EPI criam linhas e os relacionamentos funcionam."""
    from datetime import date, timedelta

    epi = EPI(name="Protetor Auricular", dias_validade=60, is_active=True)
    db_session.add(epi)
    await db_session.flush()

    mapping = CargoEPI(cargo="Polidor", epi_id=epi.id, is_active=True)
    db_session.add(mapping)

    entrega = EntregaEPI(
        employee_id=test_employee.id,
        epi_id=epi.id,
        data_entrega=date(2026, 8, 5),
        data_vencimento=date(2026, 8, 5) + timedelta(days=60),
        status=EntregaEPIStatus.ENTREGUE.value,
        assinatura_base64="data:image/png;base64,AAAA",
    )
    db_session.add(entrega)
    await db_session.flush()

    assert epi.id is not None
    assert mapping.epi_id == epi.id
    assert entrega.data_vencimento == date(2026, 10, 4)
    assert entrega.status == "ENTREGUE"
    assert PendenciaEstado.PENDENTE.value == "PENDENTE"


@pytest.mark.asyncio
async def test_owner_cria_e_lista_epi(owner_client):
    resp = await owner_client.post(
        "/api/v1/epi/catalog",
        json={"name": "Bota", "dias_validade": 90},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["dias_validade"] == 90

    listing = await owner_client.get("/api/v1/epi/catalog")
    assert listing.status_code == 200
    assert listing.json()["pagination"]["total"] == 1


@pytest.mark.asyncio
async def test_dias_validade_deve_ser_positivo(owner_client):
    resp = await owner_client.post(
        "/api/v1/epi/catalog",
        json={"name": "Luva", "dias_validade": 0},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_atualiza_e_desativa_epi(owner_client):
    created = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "Óculos", "dias_validade": 30}
    )
    epi_id = created.json()["id"]

    patched = await owner_client.patch(f"/api/v1/epi/catalog/{epi_id}", json={"dias_validade": 45})
    assert patched.status_code == 200
    assert patched.json()["dias_validade"] == 45

    deleted = await owner_client.delete(f"/api/v1/epi/catalog/{epi_id}")
    assert deleted.status_code == 200

    # Por padrão a listagem só traz ativos
    listing = await owner_client.get("/api/v1/epi/catalog")
    assert listing.json()["pagination"]["total"] == 0


@pytest.mark.asyncio
async def test_catalog_exige_permissao_epi(authenticated_client):
    """authenticated_client tem só service_orders, não epi."""
    resp = await authenticated_client.get("/api/v1/epi/catalog")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_nome_epi_duplicado_da_409(owner_client):
    payload = {"name": "Bota Duplicada", "dias_validade": 90}
    first = await owner_client.post("/api/v1/epi/catalog", json=payload)
    assert first.status_code == 201, first.text

    dup = await owner_client.post("/api/v1/epi/catalog", json=payload)
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_listagem_only_active_false_inclui_desativados(owner_client):
    created = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "EPI Desativado", "dias_validade": 30}
    )
    epi_id = created.json()["id"]
    await owner_client.delete(f"/api/v1/epi/catalog/{epi_id}")

    # Por padrão (só ativos) não aparece
    ativos = await owner_client.get("/api/v1/epi/catalog")
    assert ativos.json()["pagination"]["total"] == 0

    # Com only_active=false aparece
    todos = await owner_client.get("/api/v1/epi/catalog?only_active=false")
    assert todos.json()["pagination"]["total"] == 1


@pytest.mark.asyncio
async def test_mapeia_cargo_epi_e_bloqueia_duplicado(owner_client):
    epi = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "Máscara", "dias_validade": 30}
    )
    epi_id = epi.json()["id"]

    resp = await owner_client.post(
        "/api/v1/epi/cargo-map", json={"cargo": "Polidor", "epi_id": epi_id}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["epi_name"] == "Máscara"
    mapping_id = resp.json()["id"]

    dup = await owner_client.post(
        "/api/v1/epi/cargo-map", json={"cargo": "Polidor", "epi_id": epi_id}
    )
    assert dup.status_code == 409

    listing = await owner_client.get("/api/v1/epi/cargo-map?cargo=Polidor")
    assert listing.json()["pagination"]["total"] == 1

    deleted = await owner_client.delete(f"/api/v1/epi/cargo-map/{mapping_id}")
    assert deleted.status_code == 200


@pytest.mark.asyncio
async def test_mapear_epi_inexistente_da_404(owner_client):
    resp = await owner_client.post(
        "/api/v1/epi/cargo-map", json={"cargo": "Polidor", "epi_id": 99999}
    )
    assert resp.status_code == 404


# --------------------------------------------------------------------------
# Entregas
# --------------------------------------------------------------------------
ASSINATURA_OK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="


@pytest.mark.asyncio
async def test_registrar_entrega_calcula_vencimento(owner_client, test_employee):
    epi = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "Cinto", "dias_validade": 60}
    )
    epi_id = epi.json()["id"]

    resp = await owner_client.post(
        "/api/v1/epi/deliveries",
        json={
            "employee_id": test_employee.id,
            "epi_id": epi_id,
            "assinatura_base64": ASSINATURA_OK,
            "data_entrega": "2026-08-05",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["data_vencimento"] == "2026-10-04"  # 05/08 + 60 dias
    assert body["status"] == "ENTREGUE"


@pytest.mark.asyncio
async def test_assinatura_vazia_rejeitada(owner_client, test_employee):
    epi = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "Avental", "dias_validade": 30}
    )
    resp = await owner_client.post(
        "/api/v1/epi/deliveries",
        json={
            "employee_id": test_employee.id,
            "epi_id": epi.json()["id"],
            "assinatura_base64": "",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_assinatura_sem_prefixo_rejeitada(owner_client, test_employee):
    epi = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "Protetor Solar", "dias_validade": 30}
    )
    resp = await owner_client.post(
        "/api/v1/epi/deliveries",
        json={
            "employee_id": test_employee.id,
            "epi_id": epi.json()["id"],
            "assinatura_base64": "abc123semprefixo",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_lista_entregas_por_funcionario(owner_client, test_employee):
    epi = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "Capacete", "dias_validade": 120}
    )
    await owner_client.post(
        "/api/v1/epi/deliveries",
        json={
            "employee_id": test_employee.id,
            "epi_id": epi.json()["id"],
            "assinatura_base64": ASSINATURA_OK,
        },
    )
    listing = await owner_client.get(f"/api/v1/epi/deliveries?employee_id={test_employee.id}")
    assert listing.status_code == 200
    assert listing.json()["pagination"]["total"] == 1
    assert listing.json()["items"][0]["employee_name"] == test_employee.name


# --------------------------------------------------------------------------
# Relatório de pendências
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_pendencias_estados(owner_client, db_session, test_employee):
    from datetime import date, timedelta

    from app.modules.epi.models import EPI, CargoEPI, EntregaEPI

    # Funcionário é Polidor
    test_employee.position = "Polidor"
    await db_session.commit()

    # Dois EPIs exigidos do Polidor
    epi_pendente = EPI(name="EPI Pendente", dias_validade=30, is_active=True)
    epi_vencido = EPI(name="EPI Vencido", dias_validade=30, is_active=True)
    db_session.add_all([epi_pendente, epi_vencido])
    await db_session.flush()
    db_session.add_all(
        [
            CargoEPI(cargo="Polidor", epi_id=epi_pendente.id, is_active=True),
            CargoEPI(cargo="Polidor", epi_id=epi_vencido.id, is_active=True),
        ]
    )
    # Entrega vencida para o segundo EPI
    ontem_vencido = date.today() - timedelta(days=10)
    db_session.add(
        EntregaEPI(
            employee_id=test_employee.id,
            epi_id=epi_vencido.id,
            data_entrega=ontem_vencido - timedelta(days=30),
            data_vencimento=ontem_vencido,
            status="ENTREGUE",
            assinatura_base64="data:image/png;base64,AAAA",
        )
    )
    await db_session.commit()

    resp = await owner_client.get("/api/v1/epi/pendencias")
    assert resp.status_code == 200
    items = resp.json()["items"]
    estados = {i["epi_name"]: i["estado"] for i in items}
    assert estados["EPI Pendente"] == "PENDENTE"
    assert estados["EPI Vencido"] == "VENCIDO"

    # Filtro por estado
    so_pendentes = await owner_client.get("/api/v1/epi/pendencias?estado=PENDENTE")
    nomes = {i["epi_name"] for i in so_pendentes.json()["items"]}
    assert nomes == {"EPI Pendente"}


@pytest.mark.asyncio
async def test_pendencias_ignora_inativos(owner_client, db_session, test_employee):
    from app.modules.epi.models import EPI, CargoEPI

    test_employee.position = "Polidor"
    test_employee.hr_status = "dismissed"
    await db_session.commit()

    epi = EPI(name="EPI Demitido", dias_validade=30, is_active=True)
    db_session.add(epi)
    await db_session.flush()
    db_session.add(CargoEPI(cargo="Polidor", epi_id=epi.id, is_active=True))
    await db_session.commit()

    resp = await owner_client.get("/api/v1/epi/pendencias")
    nomes = {i["epi_name"] for i in resp.json()["items"]}
    assert "EPI Demitido" not in nomes


@pytest.mark.asyncio
async def test_pendencias_em_dia_nao_aparece_no_filtro(owner_client, db_session, test_employee):
    from datetime import date, timedelta

    from app.modules.epi.models import EPI, CargoEPI, EntregaEPI

    test_employee.position = "Polidor"
    await db_session.commit()

    epi = EPI(name="EPI Em Dia", dias_validade=60, is_active=True)
    db_session.add(epi)
    await db_session.flush()
    db_session.add(CargoEPI(cargo="Polidor", epi_id=epi.id, is_active=True))
    db_session.add(
        EntregaEPI(
            employee_id=test_employee.id,
            epi_id=epi.id,
            data_entrega=date.today(),
            data_vencimento=date.today() + timedelta(days=60),
            status="ENTREGUE",
            assinatura_base64="data:image/png;base64,AAAA",
        )
    )
    await db_session.commit()

    resp = await owner_client.get("/api/v1/epi/pendencias?estado=VENCIDO")
    nomes = {i["epi_name"] for i in resp.json()["items"]}
    assert "EPI Em Dia" not in nomes


# --------------------------------------------------------------------------
# Testes de caminhos negativos (liability-critical)
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_entrega_funcionario_inativo_da_409(owner_client, db_session, test_employee):
    epi = await owner_client.post(
        "/api/v1/epi/catalog", json={"name": "EPI Inativo Func", "dias_validade": 30}
    )
    test_employee.hr_status = "dismissed"
    await db_session.commit()

    resp = await owner_client.post(
        "/api/v1/epi/deliveries",
        json={
            "employee_id": test_employee.id,
            "epi_id": epi.json()["id"],
            "assinatura_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_entrega_loja_sem_acesso_da_404(client, db_session, test_store, second_store):
    from app.core.security import get_password_hash
    from app.modules.access_profiles.models import (
        AccessProfile,
        AccessProfileModulePermission,
        access_profile_users,
    )
    from app.modules.auth.models import User
    from app.modules.employees.models import Employee
    from tests.conftest import VALID_TEST_PASSWORD

    # Usuario nao-owner, escopado a test_store, com permissao epi
    user = User(
        email="epi_user@test.com",
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="EPI User",
        role="user",
        store_id=test_store.id,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    profile = AccessProfile(name="EPI Profile", is_active=True)
    db_session.add(profile)
    await db_session.flush()
    db_session.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="ADM",
            sub_module="epi",
            can_view=True,
            can_edit=True,
            can_delete=True,
        )
    )
    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=user.id)
    )
    # Funcionario em OUTRA loja
    other_emp = Employee(name="Fulano Outra Loja", store_id=second_store.id, is_active=True)
    epi = EPI(name="EPI Cross Loja", dias_validade=30, is_active=True)
    db_session.add_all([other_emp, epi])
    await db_session.commit()

    login = await client.post(
        "/api/v1/auth/login",
        data={"username": "epi_user@test.com", "password": VALID_TEST_PASSWORD},
    )
    token = login.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(
        "/api/v1/epi/deliveries",
        json={
            "employee_id": other_emp.id,
            "epi_id": epi.id,
            "assinatura_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
        },
    )
    assert resp.status_code == 404
