"""
Consultant router - API endpoints for consultant management.
"""

from urllib.parse import quote_plus

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission, store_scope_cache_key
from app.core.redis import cached_catalog
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.consultants import service
from app.modules.consultants.schemas import (
    ConsultantCreate,
    ConsultantListResponse,
    ConsultantResponse,
    ConsultantUpdate,
)

router = APIRouter(prefix="/consultants", tags=["Consultants"])


@router.get("", response_model=ConsultantListResponse)
async def list_consultants(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    dealership_id: int | None = Query(None, description="Filtrar por concessionária"),
    store_id: int | None = Query(None, description="Filtrar por loja"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    search: str | None = Query(None, description="Busca por nome ou email"),
):
    """
    Lista todos os consultores.
    - Owner: vê todos os consultores
    - Demais: veem consultores das lojas do seu perfil de acesso (apply_store_filter)
    - search: filtra por nome (ILIKE) ou email (ILIKE)

    Catálogo consumido pelo editor de O.S.: leitura cacheada por escopo de
    usuário (store_scope_cache_key) + filtros, para não vazar consultor de loja
    fora do perfil de outro usuário.
    """

    async def _compute():
        consultants, total = await service.list_consultants(
            db=db,
            user=current_user,
            dealership_id=dealership_id,
            store_id=store_id,
            is_active=is_active,
            search=search,
            page=pagination["page"],
            limit=pagination["limit"],
        )

        return PaginatedResponse.create(
            items=[
                ConsultantResponse.model_validate(service.build_consultant_response(c))
                for c in consultants
            ],
            total=total,
            page=pagination["page"],
            limit=pagination["limit"],
        )

    cache_key = (
        f"consultants:list:{store_scope_cache_key(current_user)}:"
        f"p{pagination['page']}:l{pagination['limit']}:deal{dealership_id}:"
        f"store{store_id}:active{is_active}:q{quote_plus(search or '')}"
    )
    return await cached_catalog(cache_key, _compute)


@router.get("/export")
async def export_consultants(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="Filtrar por loja"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    search: str | None = Query(None, description="Busca por nome ou email"),
):
    """Exporta lista de consultores para Excel (.xlsx)."""
    import io

    import openpyxl
    from fastapi.responses import StreamingResponse

    consultants, _ = await service.list_consultants(
        db=db,
        user=current_user,
        store_id=store_id,
        is_active=is_active,
        search=search,
        page=1,
        limit=9999,
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Consultores"
    ws.append(
        [
            "Nome",
            "Loja",
            "Telefone",
            "E-mail",
            "PIX",
            "Banco",
            "Agência",
            "Conta",
            "Tipo Conta",
            "Status",
        ]
    )
    for c in consultants:
        store_name = c.store.name if c.store else ""
        ws.append(
            [
                c.name,
                store_name,
                c.phone or "",
                c.email or "",
                c.pix_key or "",
                c.bank_name or "",
                c.bank_agency or "",
                c.bank_account or "",
                c.bank_account_type or "",
                "Ativo" if c.is_active else "Inativo",
            ]
        )

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=consultores.xlsx"},
    )


@router.get("/{consultant_id}", response_model=ConsultantResponse)
async def get_consultant(
    consultant_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de um consultor específico."""
    consultant = await service.get_consultant(db=db, consultant_id=consultant_id, user=current_user)
    return ConsultantResponse.model_validate(service.build_consultant_response(consultant))


@router.post("", response_model=ConsultantResponse, status_code=status.HTTP_201_CREATED)
async def create_consultant(
    data: ConsultantCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("consultants", "can_edit")),
):
    """
    Cria um novo consultor.
    Exige consultants:can_edit e acesso à loja informada (validado no service).
    """
    consultant = await service.create_consultant(db=db, data=data, user=current_user)
    return ConsultantResponse.model_validate(service.build_consultant_response(consultant))


@router.patch(
    "/{consultant_id}",
    response_model=ConsultantResponse,
    dependencies=[Depends(check_profile_permission("consultants", "can_edit"))],
)
async def update_consultant(
    consultant_id: int,
    data: ConsultantUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza um consultor existente.
    Exige consultants:can_edit (ou Owner); escopo de loja validado no service
    (get_consultant → require_resource_access na loja da concessionária).
    """
    consultant = await service.update_consultant(
        db=db, consultant_id=consultant_id, data=data, user=current_user
    )
    return ConsultantResponse.model_validate(service.build_consultant_response(consultant))


@router.delete(
    "/{consultant_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(check_profile_permission("consultants", "can_delete"))],
)
async def delete_consultant(
    consultant_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Exclui permanentemente um consultor.
    Exige consultants:can_delete (ou Owner); escopo de loja validado no service.
    Antes de excluir, preserva o nome do consultor em todas as O.S. vinculadas
    (campo consultant_name), garantindo o histórico mesmo após a exclusão.
    """
    return await service.delete_consultant(db=db, consultant_id=consultant_id, user=current_user)
