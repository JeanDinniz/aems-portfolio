"""
Inventory router - API endpoints for film type and roll management.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission
from app.core.redis import cached_catalog
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.inventory import service as inventory_service
from app.modules.inventory.schemas import (
    AdjustMetersRequest,
    FilmConsumptionResponse,
    FilmRollCreate,
    FilmRollListResponse,
    FilmRollResponse,
    FilmRollTransfer,
    FilmRollUpdate,
    FilmTypeCreate,
    FilmTypeForecastResponse,
    FilmTypeListResponse,
    FilmTypeResponse,
    FilmTypeServiceCreate,
    FilmTypeServiceResponse,
    FilmTypeUpdate,
    FilmWithdrawalCreate,
    FilmWithdrawalListResponse,
    FilmWithdrawalResponse,
    FilmWithdrawalSummaryItem,
    FilmWithdrawalSummaryResponse,
)

# ---------------------------------------------------------------------------
# Film Types router
# ---------------------------------------------------------------------------

film_types_router = APIRouter(
    prefix="/film-types",
    tags=["Film Types"],
)


@film_types_router.get("", response_model=FilmTypeListResponse)
async def list_film_types(
    include_inactive: bool = Query(False, description="Incluir tipos desativados"),
    department: str | None = Query(None, description="Filtrar por departamento: film ou ppf"),
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
):
    """
    Lista todos os tipos de película com seus serviços vinculados.

    Dado de referência cross-módulo (usado por Estoque, Agendamentos e O.S.):
    acessível a qualquer usuário autenticado, como Marcas/Serviços/Consultores/
    Modelos/Bobinas. O CRUD de tipos de película permanece restrito.

    Sem escopo por loja (mesmo resultado para qualquer usuário autenticado) —
    a chave de cache não precisa do escopo do usuário, só dos filtros.
    """

    async def _compute():
        film_types, total = await inventory_service.list_film_types(
            db=db,
            page=pagination["page"],
            limit=pagination["limit"],
            include_inactive=include_inactive,
            department=department,
        )

        items = []
        for ft in film_types:
            services_data = []
            for assoc in ft.service_associations:
                svc = assoc.service
                services_data.append(
                    FilmTypeServiceResponse(
                        service_id=assoc.service_id,
                        service_name=svc.name if svc else None,
                        service_code=svc.code if svc else None,
                        meters_consumed=assoc.meters_consumed,
                    )
                )
            items.append(
                FilmTypeResponse(
                    id=ft.id,
                    name=ft.name,
                    department=ft.department,
                    yellow_threshold_meters=ft.yellow_threshold_meters,
                    red_threshold_meters=ft.red_threshold_meters,
                    is_active=ft.is_active,
                    available_tonalities=ft.available_tonalities,
                    created_at=ft.created_at,
                    updated_at=ft.updated_at,
                    services=services_data,
                )
            )

        return PaginatedResponse.create(
            items=items,
            total=total,
            page=pagination["page"],
            limit=pagination["limit"],
        )

    cache_key = (
        f"filmtypes:list:p{pagination['page']}:l{pagination['limit']}:"
        f"inactive{include_inactive}:dept{department}"
    )
    return await cached_catalog(cache_key, _compute)


@film_types_router.post("", response_model=FilmTypeResponse, status_code=status.HTTP_201_CREATED)
async def create_film_type(
    data: FilmTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Cria um novo tipo de película.
    Requer permissão can_edit no módulo inventory.
    """
    film_type = await inventory_service.create_film_type(
        db=db, data=data, created_by_id=current_user.id
    )
    return _build_film_type_response(film_type)


@film_types_router.patch("/{film_type_id}", response_model=FilmTypeResponse)
async def update_film_type(
    film_type_id: int,
    data: FilmTypeUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Atualiza um tipo de película.
    Requer permissão can_edit no módulo inventory.
    """
    film_type = await inventory_service.update_film_type(
        db=db, film_type_id=film_type_id, data=data
    )
    return _build_film_type_response(film_type)


@film_types_router.delete("/{film_type_id}", status_code=status.HTTP_200_OK)
async def delete_film_type(
    film_type_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_delete")),
):
    """
    Exclui permanentemente um tipo de película.
    Bloqueado com 409 se existirem bobinas vinculadas.
    Requer permissão can_delete no módulo inventory.
    """
    await inventory_service.delete_film_type_hard(
        db=db, film_type_id=film_type_id, user_id=current_user.id
    )
    return {"detail": "Tipo de película excluído com sucesso"}


@film_types_router.get(
    "/{film_type_id}/forecast",
    response_model=FilmTypeForecastResponse,
)
async def get_film_type_forecast(
    film_type_id: int,
    store_id: int = Query(..., description="ID da loja para calcular a previsão"),
    db: AsyncSession = Depends(get_db),
    _=Depends(check_profile_permission("inventory", "can_view")),
):
    """
    Retorna a previsão de consumo de um tipo de película em uma loja.

    Agrega todas as O.S. em waiting/in_progress com aquele film_type_id
    e store_id, somando os metros a serem consumidos.
    Indica will_exhaust=true quando os metros previstos superam o estoque disponível.
    """
    forecast = await inventory_service.get_film_type_forecast(
        db=db, film_type_id=film_type_id, store_id=store_id
    )
    return FilmTypeForecastResponse(**forecast)


@film_types_router.post(
    "/{film_type_id}/services",
    response_model=FilmTypeServiceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_service_to_film_type(
    film_type_id: int,
    data: FilmTypeServiceCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Vincula um serviço a um tipo de película com a quantidade de metros consumidos.
    Se o serviço já estiver vinculado, atualiza os metros consumidos.
    Requer permissão can_edit no módulo inventory.
    """
    association = await inventory_service.add_service_to_film_type(
        db=db, film_type_id=film_type_id, data=data
    )
    svc = association.service
    return FilmTypeServiceResponse(
        service_id=association.service_id,
        service_name=svc.name if svc else None,
        service_code=svc.code if svc else None,
        meters_consumed=association.meters_consumed,
    )


@film_types_router.delete(
    "/{film_type_id}/services/{service_id}",
    status_code=status.HTTP_200_OK,
)
async def remove_service_from_film_type(
    film_type_id: int,
    service_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Remove a vinculação entre um serviço e um tipo de película.
    Requer permissão can_edit no módulo inventory.
    """
    await inventory_service.remove_service_from_film_type(
        db=db, film_type_id=film_type_id, service_id=service_id
    )
    return {"detail": "Serviço removido do tipo de película com sucesso"}


def _build_film_type_response(ft) -> FilmTypeResponse:
    """Helper para construir FilmTypeResponse a partir do model."""
    services_data = []
    for assoc in ft.service_associations:
        svc = assoc.service
        services_data.append(
            FilmTypeServiceResponse(
                service_id=assoc.service_id,
                service_name=svc.name if svc else None,
                service_code=svc.code if svc else None,
                meters_consumed=assoc.meters_consumed,
            )
        )
    return FilmTypeResponse(
        id=ft.id,
        name=ft.name,
        department=ft.department,
        yellow_threshold_meters=ft.yellow_threshold_meters,
        red_threshold_meters=ft.red_threshold_meters,
        is_active=ft.is_active,
        available_tonalities=ft.available_tonalities,
        created_at=ft.created_at,
        updated_at=ft.updated_at,
        services=services_data,
    )


# ---------------------------------------------------------------------------
# Inventory (Rolls) router
# ---------------------------------------------------------------------------

inventory_router = APIRouter(prefix="/inventory", tags=["Inventory - Film Rolls"])


@inventory_router.get("/rolls", response_model=FilmRollListResponse)
async def list_rolls(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    film_type_id: int | None = Query(None, description="Filtrar por tipo de película"),
    service_id: int | None = Query(
        None,
        description="Filtrar bobinas compatíveis com o serviço (resolve film_type via FilmTypeService)",
    ),
    status: str | None = Query(
        None,
        description="Filtrar por status (singular, compat legado): em_estoque, em_uso, esgotada",
    ),
    statuses: list[str] | None = Query(
        None,
        description=(
            "Filtrar por MÚLTIPLOS status numa única request "
            "(ex.: ?statuses=em_uso&statuses=esgotada). Tem prioridade sobre `status`."
        ),
    ),
    department: str | None = Query(None, description="Filtrar por departamento: film ou ppf"),
    use_galpon_store: bool = Query(
        False,
        description="Usar estoque da loja galpão (para OS com is_galpon=true)",
    ),
    include_roll_ids: list[int] | None = Query(
        None,
        description=(
            "Bobinas que devem aparecer sempre no resultado, ignorando os filtros de "
            "atributo (status/departamento/tipo). Use para manter selecionável uma bobina "
            "já vinculada a uma O.S., mesmo esgotada."
        ),
    ),
    pagination: dict = Depends(get_pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Lista bobinas de película com filtros opcionais.
    Owner vê todas as lojas; usuários com perfil de acesso veem apenas suas lojas.
    Quando use_galpon_store=True, retorna apenas bobinas da loja marcada como galpão,
    ignorando o filtro de permissão de loja.
    """
    # statuses (lista) tem prioridade; status (singular) mantém compat legada.
    effective_statuses = statuses or ([status] if status else None)
    rolls, total = await inventory_service.list_rolls(
        db=db,
        user=current_user,
        store_id=store_id,
        film_type_id=film_type_id,
        service_id=service_id,
        statuses=effective_statuses,
        department=department,
        page=pagination["page"],
        limit=pagination["limit"],
        use_galpon_store=use_galpon_store,
        include_roll_ids=include_roll_ids,
    )

    items = [_build_roll_response(r) for r in rolls]
    return PaginatedResponse.create(
        items=items,
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@inventory_router.get("/rolls/critical", response_model=list[FilmRollResponse])
async def list_critical_rolls(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Lista bobinas em nível crítico (cor vermelha).
    Usada pelo frontend para exibir modal de confirmação ao registrar novas bobinas.
    """
    rolls = await inventory_service.list_critical_rolls(db=db, user=current_user, store_id=store_id)
    return [_build_roll_response(r) for r in rolls]


@inventory_router.post(
    "/rolls",
    response_model=FilmRollResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_roll(
    data: FilmRollCreate,
    response: Response,
    force: bool = Query(False, description="Ignorar aviso de bobinas críticas pendentes"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Registra uma nova bobina de película no estoque.

    Se existirem bobinas críticas do mesmo tipo/loja, retorna 409 com o header
    `X-Has-Critical-Rolls: true` para que o frontend possa exibir um modal de confirmação.
    Passe `force=true` para confirmar o cadastro mesmo com bobinas críticas pendentes.
    Requer permissão can_edit no módulo inventory.
    """
    roll = await inventory_service.register_roll(db=db, data=data, user=current_user, force=force)
    return _build_roll_response(roll)


@inventory_router.patch(
    "/rolls/{film_roll_id}",
    response_model=FilmRollResponse,
)
async def update_roll(
    film_roll_id: int,
    data: FilmRollUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Edita os dados de uma bobina (tipo, tonalidade, fornecedor, NF, custo, lote,
    data de recebimento, metros totais). O saldo não é editado aqui — alterar os
    metros totais recalcula o restante preservando o consumo. Requer can_edit.
    """
    roll = await inventory_service.update_roll(
        db=db, film_roll_id=film_roll_id, data=data, user=current_user
    )
    return _build_roll_response(roll)


@inventory_router.patch(
    "/rolls/{film_roll_id}/exhaust",
    response_model=FilmRollResponse,
)
async def exhaust_roll(
    film_roll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Marca uma bobina como esgotada manualmente.
    Requer permissão can_edit no módulo inventory.
    """
    roll = await inventory_service.exhaust_roll(db=db, film_roll_id=film_roll_id, user=current_user)
    return _build_roll_response(roll)


@inventory_router.patch(
    "/rolls/{film_roll_id}/restore",
    response_model=FilmRollResponse,
)
async def restore_roll(
    film_roll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """Restaura uma bobina esgotada para em_uso ou em_estoque. Requer can_edit no módulo inventory."""
    roll = await inventory_service.restore_roll(db=db, film_roll_id=film_roll_id, user=current_user)
    return _build_roll_response(roll)


@inventory_router.patch(
    "/rolls/{film_roll_id}/open",
    response_model=FilmRollResponse,
)
async def open_roll(
    film_roll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Abre uma bobina para uso (em_estoque → em_uso).

    Só bobinas 'em_estoque' podem ser abertas. Abrir é a condição para que a bobina
    possa receber consumo. Requer permissão can_edit no módulo inventory.
    """
    roll = await inventory_service.open_roll(db=db, film_roll_id=film_roll_id, user=current_user)
    return _build_roll_response(roll)


@inventory_router.patch(
    "/rolls/{film_roll_id}/adjust-meters",
    response_model=FilmRollResponse,
)
async def adjust_roll_meters(
    film_roll_id: int,
    data: AdjustMetersRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Ajusta os metros restantes de uma bobina para bater com a contagem física
    (conferência de estoque). Auditado. Requer permissão can_edit no módulo inventory.
    """
    roll = await inventory_service.adjust_roll_meters(
        db=db,
        film_roll_id=film_roll_id,
        new_remaining=data.remaining_meters,
        user=current_user,
        note=data.note,
    )
    return _build_roll_response(roll)


@inventory_router.post(
    "/rolls/{film_roll_id}/transfer",
    response_model=FilmRollResponse,
)
async def transfer_film_roll(
    film_roll_id: int,
    data: FilmRollTransfer,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Transfere uma bobina para outra loja.

    Bobinas 'em_estoque' ou 'em_uso' podem ser transferidas (a parcialmente
    usada leva os metros restantes e o histórico junto); 'esgotada' não.
    Requer permissão can_edit no módulo inventory.
    """
    roll = await inventory_service.transfer_film_roll(
        db=db,
        roll_id=film_roll_id,
        target_store_id=data.target_store_id,
        current_user=current_user,
    )
    return _build_roll_response(roll)


@inventory_router.delete(
    "/rolls/{film_roll_id}",
    status_code=status.HTTP_200_OK,
)
async def delete_film_roll(
    film_roll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_delete")),
):
    """
    Exclui permanentemente uma bobina do estoque.

    Bloqueado com 409 se a bobina tiver registros de consumo (carros que a utilizaram).
    Requer permissão can_delete no módulo inventory.
    """
    await inventory_service.delete_film_roll(db=db, film_roll_id=film_roll_id, user=current_user)
    return {"detail": "Bobina excluída com sucesso"}


@inventory_router.get(
    "/rolls/{film_roll_id}/consumptions",
    response_model=list[FilmConsumptionResponse],
)
async def list_consumptions(
    film_roll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Lista o histórico de consumo de uma bobina específica.
    Requer acesso à loja da bobina.
    """
    consumptions = await inventory_service.list_consumptions(
        db=db, film_roll_id=film_roll_id, user=current_user
    )
    return [FilmConsumptionResponse(**c) for c in consumptions]


@inventory_router.get("/export")
async def export_inventory_rolls(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    film_type_id: int | None = Query(None, description="Filtrar por tipo de película"),
    status: str | None = Query(None, description="Filtrar por status"),
    department: str | None = Query(None, description="Filtrar por departamento: film ou ppf"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> Response:
    """
    Gera Excel do Relatório de Estoque de Película com todas as bobinas
    filtradas pelos mesmos parâmetros da listagem.
    """
    from datetime import date

    from app.modules.service_orders import export as so_export

    rolls = await inventory_service.list_rolls_for_export(
        db=db,
        user=current_user,
        store_id=store_id,
        film_type_id=film_type_id,
        status=status,
        department=department,
    )

    # visual_id computado por bobina (não muta o ORM: passa mapa ao gerador)
    visual_ids = {
        roll.id: inventory_service._build_roll_response_dict(roll)["visual_id"] for roll in rolls
    }

    content = so_export.generate_inventory_excel(rolls, visual_ids)
    today = date.today().strftime("%Y%m%d")
    filename = f"estoque_pelicula_{today}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@inventory_router.get("/rolls/{film_roll_id}/export")
async def export_roll(
    film_roll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> Response:
    """
    Gera Excel do Relatório de Película por Bobina com todas as OS que usaram esta bobina.
    """
    from app.modules.service_orders import export as so_export

    roll, items = await inventory_service.get_roll_items_for_export(
        db=db, film_roll_id=film_roll_id, user=current_user
    )

    computed = inventory_service._build_roll_response_dict(roll)

    content = so_export.generate_roll_excel(roll, items, computed["visual_id"])
    visual_id_safe = (
        (computed["visual_id"] or f"bobina_{roll.id}")
        .replace(" ", "_")
        .replace("[", "")
        .replace("]", "")
    )
    filename = f"{visual_id_safe}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Film Withdrawals (saída avulsa)
# ---------------------------------------------------------------------------


@inventory_router.get("/withdrawals", response_model=FilmWithdrawalListResponse)
async def list_withdrawals(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    employee_id: int | None = Query(None, description="Filtrar por funcionário"),
    film_type_id: int | None = Query(None, description="Filtrar por tipo de película"),
    date_from: date | None = Query(None, description="Data inicial (fuso local)"),
    date_to: date | None = Query(None, description="Data final (fuso local, inclusiva)"),
    pagination: dict = Depends(get_pagination_params),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_view")),
):
    """
    Lista saídas avulsas de película (inclui estornadas, marcadas com is_reversed).
    Requer permissão can_view no módulo inventory.
    """
    withdrawals, total = await inventory_service.list_withdrawals(
        db=db,
        user=current_user,
        store_id=store_id,
        employee_id=employee_id,
        film_type_id=film_type_id,
        date_from=date_from,
        date_to=date_to,
        page=pagination["page"],
        limit=pagination["limit"],
    )
    items = [
        FilmWithdrawalResponse(**inventory_service.build_withdrawal_response_dict(w))
        for w in withdrawals
    ]
    return PaginatedResponse.create(
        items=items,
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@inventory_router.get("/withdrawals/summary", response_model=FilmWithdrawalSummaryResponse)
async def get_withdrawals_summary(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    employee_id: int | None = Query(None, description="Filtrar por funcionário"),
    film_type_id: int | None = Query(None, description="Filtrar por tipo de película"),
    date_from: date | None = Query(None, description="Data inicial (fuso local)"),
    date_to: date | None = Query(None, description="Data final (fuso local, inclusiva)"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_view")),
):
    """
    Totais de saídas avulsas por funcionário no período (base do desconto em folha).
    Exclui saídas estornadas. Requer can_view no módulo inventory.
    """
    summary = await inventory_service.summarize_withdrawals(
        db=db,
        user=current_user,
        store_id=store_id,
        employee_id=employee_id,
        film_type_id=film_type_id,
        date_from=date_from,
        date_to=date_to,
    )
    return FilmWithdrawalSummaryResponse(
        items=[FilmWithdrawalSummaryItem(**item) for item in summary],
        total_meters=sum(item["total_meters"] for item in summary),
    )


@inventory_router.get("/withdrawals/export")
async def export_withdrawals(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    employee_id: int | None = Query(None, description="Filtrar por funcionário"),
    film_type_id: int | None = Query(None, description="Filtrar por tipo de película"),
    date_from: date | None = Query(None, description="Data inicial (fuso local)"),
    date_to: date | None = Query(None, description="Data final (fuso local, inclusiva)"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_view")),
) -> Response:
    """
    Gera Excel das saídas avulsas: aba com todas as saídas do filtro + aba
    de resumo por funcionário (exclui estornadas). Requer can_view.
    """
    from app.modules.inventory import export as inventory_export

    withdrawals = await inventory_service.list_withdrawals_for_export(
        db=db,
        user=current_user,
        store_id=store_id,
        employee_id=employee_id,
        film_type_id=film_type_id,
        date_from=date_from,
        date_to=date_to,
    )
    summary = await inventory_service.summarize_withdrawals(
        db=db,
        user=current_user,
        store_id=store_id,
        employee_id=employee_id,
        film_type_id=film_type_id,
        date_from=date_from,
        date_to=date_to,
    )

    content = inventory_export.generate_withdrawals_excel(withdrawals, summary)
    today = date.today().strftime("%Y%m%d")
    filename = f"saidas_pelicula_{today}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@inventory_router.post(
    "/withdrawals",
    response_model=FilmWithdrawalResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_withdrawal(
    data: FilmWithdrawalCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_edit")),
):
    """
    Registra uma saída avulsa de película: dá baixa nos metros da bobina e
    registra o funcionário que pediu, para desconto no fim do mês.
    Requer permissão can_edit no módulo inventory.
    """
    withdrawal = await inventory_service.create_withdrawal(db=db, data=data, user=current_user)
    return FilmWithdrawalResponse(**inventory_service.build_withdrawal_response_dict(withdrawal))


@inventory_router.post(
    "/withdrawals/{withdrawal_id}/reverse",
    response_model=FilmWithdrawalResponse,
)
async def reverse_withdrawal(
    withdrawal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("inventory", "can_delete")),
):
    """
    Estorna uma saída avulsa: devolve os metros à bobina e marca a saída como
    estornada (permanece no histórico, sai do resumo por funcionário).
    Não restaura bobina esgotada (restauração é manual).
    Requer permissão can_delete no módulo inventory.
    """
    withdrawal = await inventory_service.reverse_withdrawal(
        db=db, withdrawal_id=withdrawal_id, user=current_user
    )
    return FilmWithdrawalResponse(**inventory_service.build_withdrawal_response_dict(withdrawal))


def _build_roll_response(roll) -> FilmRollResponse:
    """Helper para construir FilmRollResponse com campos computados."""
    computed = inventory_service._build_roll_response_dict(roll)
    return FilmRollResponse(
        id=roll.id,
        store_id=roll.store_id,
        store_name=computed["store_name"],
        film_type_id=roll.film_type_id,
        film_type_name=computed["film_type_name"],
        tonality=roll.tonality,
        supplier=roll.supplier,
        supplier_id=roll.supplier_id,
        supplier_name=computed["supplier_name"],
        nfe_number=roll.nfe_number,
        cost=roll.cost,
        lot_number=roll.lot_number,
        total_meters=roll.total_meters,
        remaining_meters=roll.remaining_meters,
        receipt_date=roll.receipt_date,
        status=roll.status,
        visual_id=computed["visual_id"],
        color=computed["color"],
        created_at=roll.created_at,
        updated_at=roll.updated_at,
    )
