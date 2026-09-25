"""Lógica de negócio do módulo de EPI."""

from datetime import date as date_type
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.core.permissions import apply_store_filter, require_resource_access
from app.modules.auth.models import User
from app.modules.employees.models import Employee
from app.modules.epi.constants import PendenciaEstado
from app.modules.epi.models import EPI, CargoEPI, EntregaEPI
from app.modules.epi.schemas import (
    CargoEPICreate,
    CargoEPIResponse,
    EntregaEPICreate,
    EntregaEPIListItem,
    EntregaEPIResponse,
    EPICreate,
    EPIUpdate,
    PendenciaItem,
)


async def create_epi(db: AsyncSession, data: EPICreate) -> EPI:
    epi = EPI(**data.model_dump())
    db.add(epi)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(detail=f"Já existe EPI com o nome '{data.name}'") from None
    await db.refresh(epi)
    return epi


async def get_epi(db: AsyncSession, epi_id: int) -> EPI:
    result = await db.execute(select(EPI).where(EPI.id == epi_id))
    epi = result.scalar_one_or_none()
    if not epi:
        raise NotFoundError(resource="EPI")
    return epi


async def list_epis(
    db: AsyncSession, page: int = 1, limit: int = 50, only_active: bool = True
) -> tuple[list[EPI], int]:
    query = select(EPI)
    if only_active:
        query = query.where(EPI.is_active.is_(True))
    return await paginate(db, query, page, limit, order_by=EPI.name)


async def update_epi(db: AsyncSession, epi_id: int, data: EPIUpdate) -> EPI:
    epi = await get_epi(db, epi_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(epi, field, value)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(detail="Nome de EPI já em uso") from None
    await db.refresh(epi)
    return epi


async def deactivate_epi(db: AsyncSession, epi_id: int) -> dict:
    """Soft delete: preserva histórico de entregas (FK RESTRICT)."""
    epi = await get_epi(db, epi_id)
    epi.is_active = False
    await db.flush()
    return {"id": epi.id, "name": epi.name, "is_active": False}


def build_cargo_epi_response(mapping: CargoEPI) -> CargoEPIResponse:
    return CargoEPIResponse(
        id=mapping.id,
        cargo=mapping.cargo,
        epi_id=mapping.epi_id,
        epi_name=mapping.epi.name if mapping.epi else "",
        is_active=mapping.is_active,
        created_at=mapping.created_at,
        updated_at=mapping.updated_at,
    )


async def create_cargo_map(db: AsyncSession, data: CargoEPICreate) -> CargoEPI:
    await get_epi(db, data.epi_id)  # 404 se EPI não existir

    exists = await db.execute(
        select(CargoEPI).where(CargoEPI.cargo == data.cargo, CargoEPI.epi_id == data.epi_id)
    )
    if exists.scalar_one_or_none():
        raise ConflictError(detail=f"'{data.cargo}' já exige esse EPI")

    mapping = CargoEPI(cargo=data.cargo, epi_id=data.epi_id, is_active=True)
    db.add(mapping)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(detail=f"'{data.cargo}' já exige esse EPI") from None
    await db.refresh(mapping)
    return mapping


async def list_cargo_maps(
    db: AsyncSession, cargo: str | None = None, page: int = 1, limit: int = 100
) -> tuple[list[CargoEPI], int]:
    query = select(CargoEPI).where(CargoEPI.is_active.is_(True))
    if cargo:
        query = query.where(CargoEPI.cargo == cargo)
    return await paginate(db, query, page, limit, order_by=CargoEPI.cargo)


async def delete_cargo_map(db: AsyncSession, mapping_id: int) -> dict:
    result = await db.execute(select(CargoEPI).where(CargoEPI.id == mapping_id))
    mapping = result.scalar_one_or_none()
    if not mapping:
        raise NotFoundError(resource="Mapeamento de cargo")
    await db.delete(mapping)
    await db.flush()
    return {"id": mapping_id, "deleted": True}


def build_entrega_response(entrega: EntregaEPI) -> EntregaEPIResponse:
    return EntregaEPIResponse(
        id=entrega.id,
        employee_id=entrega.employee_id,
        employee_name=entrega.employee.name if entrega.employee else "",
        epi_id=entrega.epi_id,
        epi_name=entrega.epi.name if entrega.epi else "",
        data_entrega=entrega.data_entrega,
        data_vencimento=entrega.data_vencimento,
        status=entrega.status,
        delivered_by_id=entrega.delivered_by_id,
        observacao=entrega.observacao,
        assinatura_base64=entrega.assinatura_base64,
        created_at=entrega.created_at,
    )


def build_entrega_list_item(entrega: EntregaEPI) -> EntregaEPIListItem:
    return EntregaEPIListItem(
        id=entrega.id,
        employee_id=entrega.employee_id,
        employee_name=entrega.employee.name if entrega.employee else "",
        epi_id=entrega.epi_id,
        epi_name=entrega.epi.name if entrega.epi else "",
        data_entrega=entrega.data_entrega,
        data_vencimento=entrega.data_vencimento,
        status=entrega.status,
        delivered_by_id=entrega.delivered_by_id,
        observacao=entrega.observacao,
        created_at=entrega.created_at,
    )


async def register_delivery(db: AsyncSession, data: EntregaEPICreate, user: User) -> EntregaEPI:
    # Funcionário existe, ativo e acessível pela loja do usuário
    emp_result = await db.execute(select(Employee).where(Employee.id == data.employee_id))
    employee = emp_result.scalar_one_or_none()
    if not employee:
        raise NotFoundError(resource="Funcionário")
    require_resource_access(user, employee.store_id, "Funcionário")
    if employee.hr_status != "active":
        raise ConflictError(detail="Funcionário não está ativo")

    epi = await get_epi(db, data.epi_id)
    if not epi.is_active:
        raise ConflictError(detail="EPI inativo")

    data_entrega = data.data_entrega or date_type.today()
    data_vencimento = data_entrega + timedelta(days=epi.dias_validade)

    entrega = EntregaEPI(
        employee_id=employee.id,
        epi_id=epi.id,
        data_entrega=data_entrega,
        data_vencimento=data_vencimento,
        status="ENTREGUE",
        assinatura_base64=data.assinatura_base64,
        delivered_by_id=user.id,
        observacao=data.observacao,
    )
    db.add(entrega)
    await db.flush()
    await db.refresh(entrega)
    return entrega


async def list_deliveries(
    db: AsyncSession,
    user: User,
    employee_id: int | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[EntregaEPI], int]:
    query = select(EntregaEPI).join(Employee, EntregaEPI.employee_id == Employee.id)
    query = apply_store_filter(query, user, Employee.store_id)
    if employee_id is not None:
        query = query.where(EntregaEPI.employee_id == employee_id)
    return await paginate(db, query, page, limit, order_by=EntregaEPI.data_entrega.desc())


async def get_pendencias(
    db: AsyncSession,
    user: User,
    estado_filtro: str | None = None,
    store_ids: list[int] | None = None,
) -> list[PendenciaItem]:
    hoje = date_type.today()

    # 1) Funcionários ativos, com cargo, filtrados por loja
    emp_query = (
        select(Employee)
        .options(selectinload(Employee.store))
        .where(Employee.hr_status == "active", Employee.position.is_not(None))
    )
    emp_query = apply_store_filter(emp_query, user, Employee.store_id)
    if store_ids:
        emp_query = emp_query.where(Employee.store_id.in_(store_ids))
    employees = list((await db.execute(emp_query)).scalars().all())
    if not employees:
        return []

    # 2) Mapa cargo -> [EPI...] (ativos)
    map_rows = list(
        (
            await db.execute(
                select(CargoEPI)
                .options(selectinload(CargoEPI.epi))
                .where(CargoEPI.is_active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    cargo_to_epis: dict[str, list[EPI]] = {}
    for m in map_rows:
        if m.epi and m.epi.is_active:
            cargo_to_epis.setdefault(m.cargo, []).append(m.epi)

    # 3) Última entrega ENTREGUE por (employee_id, epi_id)
    emp_ids = [e.id for e in employees]
    entregas = list(
        (
            await db.execute(
                select(EntregaEPI)
                .where(
                    EntregaEPI.employee_id.in_(emp_ids),
                    EntregaEPI.status == "ENTREGUE",
                )
                .order_by(EntregaEPI.data_entrega.desc(), EntregaEPI.id.desc())
            )
        )
        .scalars()
        .all()
    )
    ultima: dict[tuple[int, int], EntregaEPI] = {}
    for ent in entregas:
        key = (ent.employee_id, ent.epi_id)
        if key not in ultima:  # já ordenado desc → primeiro é o mais recente
            ultima[key] = ent

    # 4) Montar a matriz e derivar o estado
    items: list[PendenciaItem] = []
    for emp in employees:
        for epi in cargo_to_epis.get(emp.position or "", []):
            ent = ultima.get((emp.id, epi.id))
            if ent is None:
                estado = PendenciaEstado.PENDENTE
                data_entrega = data_vencimento = None
                dias_restantes = None
                ultima_id = None
            elif ent.data_vencimento < hoje:
                estado = PendenciaEstado.VENCIDO
                data_entrega = ent.data_entrega
                data_vencimento = ent.data_vencimento
                dias_restantes = (ent.data_vencimento - hoje).days
                ultima_id = ent.id
            else:
                estado = PendenciaEstado.EM_DIA
                data_entrega = ent.data_entrega
                data_vencimento = ent.data_vencimento
                dias_restantes = (ent.data_vencimento - hoje).days
                ultima_id = ent.id

            if estado_filtro and estado.value != estado_filtro:
                continue

            items.append(
                PendenciaItem(
                    employee_id=emp.id,
                    employee_name=emp.name,
                    store_id=emp.store_id,
                    store_name=emp.store.name if emp.store else None,
                    cargo=emp.position or "",
                    epi_id=epi.id,
                    epi_name=epi.name,
                    dias_validade=epi.dias_validade,
                    estado=estado.value,
                    ultima_entrega_id=ultima_id,
                    data_entrega=data_entrega,
                    data_vencimento=data_vencimento,
                    dias_restantes=dias_restantes,
                )
            )

    # Ordena: vencidos primeiro, depois pendentes, depois em dia
    ordem = {
        PendenciaEstado.VENCIDO.value: 0,
        PendenciaEstado.PENDENTE.value: 1,
        PendenciaEstado.EM_DIA.value: 2,
    }
    items.sort(key=lambda i: (ordem.get(i.estado, 9), i.employee_name, i.epi_name))
    return items
