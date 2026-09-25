"""
Users router - API endpoints for user management.
"""

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    UserRole,
    check_any_profile_permission,
    check_profile_permission,
    require_roles,
)
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.users import service
from app.modules.users.schemas import (
    PasswordResetResponse,
    UserCreate,
    UserListResponse,
    UserResponse,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["Users"])


@router.get(
    "",
    response_model=UserListResponse,
    dependencies=[Depends(check_profile_permission("users", "can_view"))],
)
async def list_users(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    role: UserRole | None = None,
    store_id: int | None = Query(None, description="Filtrar por loja"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    search: str | None = Query(None, description="Busca por nome ou e-mail"),
    has_employee: bool | None = Query(
        None, description="Filtrar por vínculo com funcionário (True=com, False=sem)"
    ),
):
    """Lista usuários — gestão de usuários (Owner ou users:can_view).

    A2 (auditoria): trava de módulo adicionada. Comboboxes de vínculo (UserCombobox,
    grant employees) e de perfil (ProfileUsersTab, grant profiles) usam a listagem
    leve GET /users/selectable, que não exige users:can_view.
    """
    users, total = await service.list_users(
        db=db,
        requesting_user=current_user,
        page=pagination["page"],
        limit=pagination["limit"],
        role=role,
        store_id=store_id,
        is_active=is_active,
        search=search,
        has_employee=has_employee,
    )

    employee_map = await service.get_linked_employees_by_user_ids(db, [u.id for u in users])

    return PaginatedResponse.create(
        items=[UserResponse.from_user(u, employee=employee_map.get(u.id)) for u in users],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/workers", response_model=list[UserResponse])
async def list_workers(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="Filtrar por loja"),
    department: str | None = Query(
        None, description="Departamento (film, ppf, bodywork, vn, vu, workshop)"
    ),
):
    """Lista funcionários para seleção em O.S. Escopo restrito à(s) loja(s) do usuário."""
    workers = await service.list_workers(
        db=db,
        store_id=store_id,
        department=department,
        requesting_user=current_user,
    )
    return [UserResponse.from_user(w) for w in workers]


@router.get(
    "/selectable",
    response_model=UserListResponse,
    dependencies=[
        Depends(
            check_any_profile_permission(
                ("users", "can_view"),
                ("employees", "can_view"),
                ("employees", "can_edit"),
                ("profiles", "can_view"),
                ("profiles", "can_edit"),
            )
        )
    ],
)
async def list_users_selectable(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    search: str | None = Query(None, description="Busca por nome ou e-mail"),
    has_employee: bool | None = Query(
        None, description="Filtrar por vínculo com funcionário (True=com, False=sem)"
    ),
):
    """Lista leve de usuários para seleção (vínculo de funcionário / perfil de acesso).

    A2 (auditoria): endpoint dedicado para os comboboxes, acessível a quem gerencia
    usuários/funcionários/perfis (ou Owner) — não exige users:can_view como o
    GET /users. Escopo de loja preservado via apply_store_filter no service.
    """
    users, total = await service.list_users(
        db=db,
        requesting_user=current_user,
        page=pagination["page"],
        limit=pagination["limit"],
        is_active=is_active,
        search=search,
        has_employee=has_employee,
    )

    employee_map = await service.get_linked_employees_by_user_ids(db, [u.id for u in users])

    return PaginatedResponse.create(
        items=[UserResponse.from_user(u, employee=employee_map.get(u.id)) for u in users],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de um usuário específico."""
    user = await service.get_user(db=db, user_id=user_id, requesting_user=current_user)
    return UserResponse.from_user(user)


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def create_user(
    data: UserCreate,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Cria um novo usuário. Apenas owners."""
    user = await service.create_user(
        db=db,
        data=data,
        created_by=current_user,
        request=http_request,
    )
    return UserResponse.from_user(user)


@router.patch(
    "/{user_id}",
    response_model=UserResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def update_user(
    user_id: int,
    data: UserUpdate,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Atualiza um usuário. Apenas owners."""
    user = await service.update_user(
        db=db,
        user_id=user_id,
        data=data,
        updated_by=current_user,
        request=http_request,
    )
    return UserResponse.from_user(user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def delete_user(
    user_id: int,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Exclui permanentemente um usuário. Apenas owners."""
    return await service.delete_user(
        db=db,
        user_id=user_id,
        deleted_by=current_user,
        request=http_request,
    )


@router.post(
    "/{user_id}/activate",
    response_model=UserResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def activate_user(
    user_id: int,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reativa um usuário desativado. Apenas owners."""
    user = await service.activate_user(
        db=db,
        user_id=user_id,
        activated_by=current_user,
        request=http_request,
    )
    return UserResponse.from_user(user)


@router.post(
    "/{user_id}/reset-password",
    response_model=PasswordResetResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def reset_password(
    user_id: int,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reseta a senha de um usuário. Apenas owners."""
    _, temporary_password = await service.reset_password(
        db=db,
        user_id=user_id,
        reset_by=current_user,
        request=http_request,
    )
    return PasswordResetResponse(temporary_password=temporary_password)
