"""
Inventory service - Business logic for film roll and type management.
"""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, cast, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.pagination import paginate
from app.core.permissions import (
    apply_store_filter,
    hide_galpon_user,
    is_galpon_profile_user,
    require_resource_access,
)
from app.modules.inventory.models import (
    FilmConsumption,
    FilmRoll,
    FilmType,
    FilmTypeService,
    FilmWithdrawal,
)
from app.modules.inventory.schemas import (
    FilmRollCreate,
    FilmTypeCreate,
    FilmTypeServiceCreate,
    FilmTypeUpdate,
    FilmWithdrawalCreate,
)

TZ_LOCAL = ZoneInfo("America/Sao_Paulo")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def compute_visual_id(
    film_type_name: str, tonality: str | None, receipt_date: date, total_meters: float
) -> str:
    """
    Gera identificador visual legível para uma bobina.
    Formato com tonalidade: NomeTipo_Tonalidade_DDMMAAAA [Metros]
    Formato sem tonalidade (PPF): NomeTipo_DDMMAAAA [Metros]
    Ex: Poliester_G05_24042026 [15] ou PPF_24042026 [30]
    """
    # Normalizar nome: remover espaços e acentos comuns
    clean_name = (
        film_type_name.replace(" ", "")
        .replace("é", "e")
        .replace("ê", "e")
        .replace("ã", "a")
        .replace("ç", "c")
        .replace("ó", "o")
        .replace("ô", "o")
        .replace("á", "a")
        .replace("â", "a")
        .replace("í", "i")
        .replace("ú", "u")
    )
    date_str = receipt_date.strftime("%d%m%Y")
    if tonality:
        return f"{clean_name}_{tonality}_{date_str} [{int(total_meters)}]"
    return f"{clean_name}_{date_str} [{int(total_meters)}]"


def get_color(roll: FilmRoll) -> str:
    """
    Calcula a cor do indicador de estoque da bobina.

    - blue:   Em Estoque (status em_estoque — disponível, não tocado)
    - green:  Em Uso, OK (status em_uso, acima do limiar de alerta)
    - yellow: Alerta de estoque baixo (status em_uso, abaixo do limiar amarelo)
    - red:    Esgotado (status esgotada)
    """
    if roll.status == "esgotada":
        return "red"
    if roll.status == "em_estoque":
        return "blue"
    # em_uso
    if roll.film_type and roll.remaining_meters < roll.film_type.yellow_threshold_meters:
        return "yellow"
    return "green"


def _build_roll_response_dict(roll: FilmRoll) -> dict:
    """Constrói dicionário com campos computados para resposta de bobina."""
    film_type_name = roll.film_type.name if roll.film_type else ""
    return {
        "visual_id": compute_visual_id(
            film_type_name, roll.tonality, roll.receipt_date, roll.total_meters
        ),
        "color": get_color(roll),
        "film_type_name": film_type_name,
        "store_name": roll.store.name if roll.store else None,
        "supplier_name": roll.supplier_rel.company_name if roll.supplier_rel else None,
    }


# ---------------------------------------------------------------------------
# Film Types
# ---------------------------------------------------------------------------


async def list_film_types(
    db: AsyncSession,
    page: int = 1,
    limit: int = 20,
    include_inactive: bool = False,
    department: str | None = None,
) -> tuple[list[FilmType], int]:
    """
    Lista tipos de película com seus serviços vinculados.

    Args:
        db: Sessão do banco de dados
        page: Página atual
        limit: Itens por página
        include_inactive: Se True, inclui tipos desativados
        department: Filtrar por departamento ('film' ou 'ppf')

    Returns:
        Tuple com lista de FilmType e total
    """
    query = select(FilmType).options(
        selectinload(FilmType.service_associations).selectinload(FilmTypeService.service)
    )
    if not include_inactive:
        query = query.where(FilmType.is_active == True)  # noqa: E712
    if department is not None:
        query = query.where(FilmType.department == department)
    return await paginate(db, query, page, limit, order_by=FilmType.name.asc())


async def get_film_type(db: AsyncSession, film_type_id: int) -> FilmType:
    """
    Busca tipo de película por ID com seus serviços vinculados.

    Raises:
        NotFoundError: Tipo não encontrado
    """
    result = await db.execute(
        select(FilmType)
        .options(selectinload(FilmType.service_associations).selectinload(FilmTypeService.service))
        .where(FilmType.id == film_type_id)
    )
    film_type = result.scalar_one_or_none()
    if not film_type:
        raise NotFoundError(resource="Tipo de Película")
    return film_type


# Tonalidades base. "Incolor" só entra por padrão em tipos de película de segurança.
_BASE_TONALITIES = ["G05", "G20", "G35", "G50", "G75"]


def _default_tonalities(department: str) -> list[str]:
    if department == "security_film":
        return [*_BASE_TONALITIES, "Incolor"]
    return list(_BASE_TONALITIES)


async def create_film_type(
    db: AsyncSession, data: FilmTypeCreate, created_by_id: int | None = None
) -> FilmType:
    """
    Cria um novo tipo de película.

    Args:
        db: Sessão do banco de dados
        data: Dados do novo tipo

    Raises:
        ConflictError: Já existe um tipo com o mesmo nome
    """
    # Verificar nome único
    existing = await db.execute(select(FilmType).where(FilmType.name == data.name))
    if existing.scalar_one_or_none():
        raise ConflictError(detail=f"Já existe um tipo de película com o nome '{data.name}'")

    film_type = FilmType(
        name=data.name,
        department=data.department,
        yellow_threshold_meters=data.yellow_threshold_meters,
        red_threshold_meters=data.red_threshold_meters,
        is_active=True,
        available_tonalities=data.available_tonalities or _default_tonalities(data.department),
    )
    db.add(film_type)
    try:
        await db.flush()
    except IntegrityError as exc:
        # Race condition (I4): outro request inseriu o mesmo nome entre o SELECT e
        # este flush. Converte IntegrityError em 409 amigável (em vez de 500).
        await db.rollback()
        raise ConflictError(
            detail=f"Já existe um tipo de película com o nome '{data.name}'"
        ) from exc

    await log_audit(
        db=db,
        action="create",
        resource_type="film_type",
        user_id=created_by_id,
        resource_id=film_type.id,
        new_value={"name": data.name, "department": data.department},
    )

    await db.refresh(film_type)
    await db.commit()

    # Catálogo de tipos de película é cacheado no editor de O.S. — invalida
    # pós-commit (get_db lê a flag e bumpa depois que o dado persistir).
    db.info["bump_catalogs"] = True

    return await get_film_type(db, film_type.id)


async def update_film_type(db: AsyncSession, film_type_id: int, data: FilmTypeUpdate) -> FilmType:
    """
    Atualiza um tipo de película.

    Args:
        db: Sessão do banco de dados
        film_type_id: ID do tipo
        data: Dados para atualização

    Raises:
        NotFoundError: Tipo não encontrado
        ConflictError: Novo nome já existe em outro tipo
    """
    lock_result = await db.execute(
        select(FilmType)
        .options(selectinload(FilmType.service_associations).selectinload(FilmTypeService.service))
        .where(FilmType.id == film_type_id)
        .with_for_update()
    )
    film_type = lock_result.scalar_one_or_none()
    if not film_type:
        raise NotFoundError(resource="Tipo de Película")

    update_data = data.model_dump(exclude_unset=True)

    # Validar estado final dos limiares (I2): considera o valor atual do banco
    # para o campo não enviado no payload (atualização parcial).
    final_yellow = update_data.get("yellow_threshold_meters", film_type.yellow_threshold_meters)
    final_red = update_data.get("red_threshold_meters", film_type.red_threshold_meters)
    if final_red >= final_yellow:
        raise ValidationError(
            detail=(
                f"O limiar vermelho ({final_red}) deve ser menor que o limiar amarelo "
                f"({final_yellow}). Ajuste os valores antes de salvar."
            )
        )

    # Verificar unicidade do nome se está sendo alterado
    if "name" in update_data and update_data["name"] != film_type.name:
        existing = await db.execute(
            select(FilmType).where(
                FilmType.name == update_data["name"],
                FilmType.id != film_type_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(
                detail=f"Já existe um tipo de película com o nome '{update_data['name']}'"
            )

    old_value = {field: getattr(film_type, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(film_type, field, value)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="film_type",
        user_id=None,
        resource_id=film_type.id,
        old_value=old_value,
        new_value=update_data,
    )

    await db.commit()

    db.info["bump_catalogs"] = True

    return await get_film_type(db, film_type_id)


async def delete_film_type_hard(
    db: AsyncSession, film_type_id: int, user_id: int | None = None
) -> None:
    """
    Exclui permanentemente um tipo de película do banco de dados.

    Bloqueia se existirem bobinas (FilmRoll) vinculadas — a FK usa RESTRICT.

    Raises:
        NotFoundError: Tipo não encontrado
        ConflictError: Existem bobinas vinculadas a este tipo
    """
    film_type = await get_film_type(db, film_type_id)

    roll_count_result = await db.execute(
        select(func.count(FilmRoll.id)).where(FilmRoll.film_type_id == film_type_id)
    )
    roll_count = roll_count_result.scalar_one()

    if roll_count > 0:
        raise ConflictError(
            detail=(
                f"Não é possível excluir: existem {roll_count} bobina(s) vinculada(s) a este tipo. "
                "Esgote ou transfira as bobinas antes de excluir."
            )
        )

    await log_audit(
        db=db,
        action="delete",
        resource_type="film_type",
        user_id=user_id,
        resource_id=film_type_id,
        old_value={"name": film_type.name, "department": film_type.department},
    )

    await db.delete(film_type)
    await db.flush()
    await db.commit()

    db.info["bump_catalogs"] = True


async def add_service_to_film_type(
    db: AsyncSession, film_type_id: int, data: FilmTypeServiceCreate
) -> FilmTypeService:
    """
    Adiciona ou atualiza a associação entre um FilmType e um Service.

    Se a associação já existir, atualiza o meters_consumed.

    Args:
        db: Sessão do banco de dados
        film_type_id: ID do tipo de película
        data: Dados da associação (service_id + meters_consumed)

    Raises:
        NotFoundError: Tipo de película ou serviço não encontrado
    """
    # Verificar que o tipo existe
    await get_film_type(db, film_type_id)

    # Verificar que o serviço existe
    from app.modules.services.models import Service

    svc_result = await db.execute(select(Service).where(Service.id == data.service_id))
    if not svc_result.scalar_one_or_none():
        raise NotFoundError(resource="Serviço")

    # Verificar se já existe associação
    existing_result = await db.execute(
        select(FilmTypeService).where(
            FilmTypeService.film_type_id == film_type_id,
            FilmTypeService.service_id == data.service_id,
        )
    )
    association = existing_result.scalar_one_or_none()

    if association:
        # Atualizar se já existe
        association.meters_consumed = data.meters_consumed
    else:
        # Criar nova associação
        association = FilmTypeService(
            film_type_id=film_type_id,
            service_id=data.service_id,
            meters_consumed=data.meters_consumed,
        )
        db.add(association)

    await db.flush()
    await db.commit()

    # Associação afeta o campo `services` do FilmTypeResponse cacheado.
    db.info["bump_catalogs"] = True

    # Recarregar com service eager loaded
    result = await db.execute(
        select(FilmTypeService)
        .options(selectinload(FilmTypeService.service))
        .where(
            FilmTypeService.film_type_id == film_type_id,
            FilmTypeService.service_id == data.service_id,
        )
    )
    return result.scalar_one()


async def remove_service_from_film_type(
    db: AsyncSession, film_type_id: int, service_id: int
) -> None:
    """
    Remove a associação entre um FilmType e um Service.

    Raises:
        NotFoundError: Tipo de película não encontrado ou serviço não estava vinculado
    """
    # Verificar tipo existe
    await get_film_type(db, film_type_id)

    result = await db.execute(
        select(FilmTypeService).where(
            FilmTypeService.film_type_id == film_type_id,
            FilmTypeService.service_id == service_id,
        )
    )
    association = result.scalar_one_or_none()
    if not association:
        raise NotFoundError(resource="Associação FilmType-Serviço")

    await db.delete(association)
    await db.flush()
    await db.commit()

    db.info["bump_catalogs"] = True


# ---------------------------------------------------------------------------
# Film Rolls
# ---------------------------------------------------------------------------


async def _get_roll_with_type(
    db: AsyncSession, film_roll_id: int, for_update: bool = False
) -> FilmRoll:
    """Busca bobina com film_type, store e supplier_rel eager loaded."""
    query = (
        select(FilmRoll)
        .options(
            selectinload(FilmRoll.film_type),
            selectinload(FilmRoll.store),
            selectinload(FilmRoll.supplier_rel),
        )
        .where(FilmRoll.id == film_roll_id)
    )
    if for_update:
        query = query.with_for_update()
    result = await db.execute(query)
    roll = result.scalar_one_or_none()
    if not roll:
        raise NotFoundError(resource="Bobina")
    return roll


async def list_rolls(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    film_type_id: int | None = None,
    service_id: int | None = None,
    statuses: list[str] | None = None,
    department: str | None = None,
    page: int = 1,
    limit: int = 20,
    use_galpon_store: bool = False,
    include_roll_ids: list[int] | None = None,
) -> tuple[list[FilmRoll], int]:
    """
    Lista bobinas de película com filtros e paginação.

    Aplica filtro de loja baseado nas permissões do usuário, a menos que
    ``use_galpon_store=True``, caso em que o filtro é fixado na loja marcada
    como ``is_galpon_store`` (sem restrição de permissão — qualquer usuário
    criando uma OS galpão precisa enxergar esse estoque).

    Args:
        db: Sessão do banco de dados
        user: Usuário atual (para controle de acesso por loja)
        store_id: Filtrar por loja específica (ignorado quando use_galpon_store=True)
        film_type_id: Filtrar por tipo de película
        statuses: Filtrar por status (lista, ex.: ``["em_uso", "esgotada"]``)
        department: Filtrar por departamento do tipo de película: film ou ppf
        page: Página atual
        limit: Itens por página
        use_galpon_store: Quando True, usa o estoque da loja marcada como galpão
        include_roll_ids: Bobinas que devem aparecer SEMPRE no resultado, ignorando
            os filtros de atributo (status/departamento/tipo/serviço). Usado para que
            uma bobina já vinculada a uma O.S. — mesmo esgotada — continue selecionável.

    Returns:
        Tuple com lista de FilmRoll e total

    Raises:
        NotFoundError: Quando use_galpon_store=True e nenhuma loja galpão está cadastrada
    """
    from app.modules.stores.models import Store

    query = select(FilmRoll).options(
        selectinload(FilmRoll.film_type),
        selectinload(FilmRoll.store),
        selectinload(FilmRoll.supplier_rel),
    )

    # Perfil galpão sempre acessa o estoque da loja galpão
    if is_galpon_profile_user(user):
        use_galpon_store = True

    if use_galpon_store:
        # Buscar a loja marcada como galpão — sem apply_store_filter intencional
        galpon_result = await db.execute(
            select(Store).where(Store.is_galpon_store == True).limit(1)  # noqa: E712
        )
        galpon_store = galpon_result.scalar_one_or_none()
        if not galpon_store:
            raise NotFoundError(resource="Loja Galpão")
        query = query.where(FilmRoll.store_id == galpon_store.id)
    else:
        # Comportamento padrão: filtro de loja por permissões
        query = apply_store_filter(query, user, FilmRoll.store_id)

        if hide_galpon_user(user):
            galpon_id_result = await db.execute(
                select(Store.id).where(Store.is_galpon_store == True).limit(1)  # noqa: E712
            )
            galpon_store_id = galpon_id_result.scalar_one_or_none()
            if galpon_store_id is not None:
                query = query.where(FilmRoll.store_id != galpon_store_id)
        # FIX (furo do seletor): `if` separado, NÃO `elif`. Antes, usuário com perfil
        # "Ocultar Galpão" caía no ramo de cima e PULAVA o filtro de loja — o seletor
        # passava a oferecer bobina de TODAS as lojas acessíveis (raiz do consumo de
        # bobina em loja errada). Agora galpão E loja são aplicados juntos (AND).
        if store_id is not None:
            # Verificar se a loja possui estoque compartilhado com parceiras
            target_store_result = await db.execute(
                select(Store)
                .options(selectinload(Store.inventory_links))
                .where(Store.id == store_id)
            )
            target_store = target_store_result.scalar_one_or_none()
            if target_store and target_store.has_shared_inventory and target_store.inventory_links:
                partner_ids = [link.linked_store_id for link in target_store.inventory_links]
                all_store_ids = [store_id] + partner_ids
                query = query.where(FilmRoll.store_id.in_(all_store_ids))
            else:
                query = query.where(FilmRoll.store_id == store_id)

    # Filtros de atributo (status/tipo/serviço/departamento). Agrupados para que
    # ``include_roll_ids`` possa furá-los via OR, mantendo o filtro de loja (acima) em AND.
    attr_conditions = []

    if film_type_id is not None:
        attr_conditions.append(FilmRoll.film_type_id == film_type_id)

    if service_id is not None:
        film_type_subquery = select(FilmTypeService.film_type_id).where(
            FilmTypeService.service_id == service_id
        )
        attr_conditions.append(FilmRoll.film_type_id.in_(film_type_subquery))

    if statuses:
        if len(statuses) == 1:
            attr_conditions.append(FilmRoll.status == statuses[0])
        else:
            attr_conditions.append(FilmRoll.status.in_(statuses))

    if department is not None:
        attr_conditions.append(
            FilmRoll.film_type_id.in_(select(FilmType.id).where(FilmType.department == department))
        )

    if attr_conditions:
        combined = and_(*attr_conditions)
        if include_roll_ids:
            query = query.where(or_(combined, FilmRoll.id.in_(include_roll_ids)))
        else:
            query = query.where(combined)

    return await paginate(db, query, page, limit, order_by=FilmRoll.receipt_date.desc())


async def get_roll(db: AsyncSession, film_roll_id: int, user) -> FilmRoll:
    """
    Busca bobina verificando permissões do usuário.

    Raises:
        NotFoundError: Bobina não encontrada ou sem permissão
    """
    roll = await _get_roll_with_type(db, film_roll_id)
    require_resource_access(user, roll.store_id, "Bobina")
    return roll


async def list_critical_rolls(
    db: AsyncSession, user, store_id: int | None = None
) -> list[FilmRoll]:
    """
    Lista bobinas em nível de alerta (cor amarela) que precisam de reposição.

    Args:
        db: Sessão do banco de dados
        user: Usuário atual
        store_id: Filtrar por loja específica

    Returns:
        Lista de FilmRoll em alerta de estoque baixo
    """
    query = (
        select(FilmRoll)
        .join(FilmType, FilmRoll.film_type_id == FilmType.id)
        .options(
            selectinload(FilmRoll.film_type),
            selectinload(FilmRoll.store),
            selectinload(FilmRoll.supplier_rel),
        )
        .where(
            FilmRoll.status.in_(["em_estoque", "em_uso"]),
            FilmRoll.remaining_meters <= FilmType.yellow_threshold_meters,
        )
    )

    from app.modules.stores.models import Store

    if is_galpon_profile_user(user):
        galpon_result = await db.execute(
            select(Store).where(Store.is_galpon_store.is_(True)).limit(1)
        )
        galpon_store = galpon_result.scalar_one_or_none()
        if not galpon_store:
            return []
        query = query.where(FilmRoll.store_id == galpon_store.id)
    else:
        query = apply_store_filter(query, user, FilmRoll.store_id)

        if hide_galpon_user(user):
            galpon_id_result = await db.execute(
                select(Store.id).where(Store.is_galpon_store.is_(True)).limit(1)
            )
            galpon_store_id = galpon_id_result.scalar_one_or_none()
            if galpon_store_id is not None:
                query = query.where(FilmRoll.store_id != galpon_store_id)
        elif store_id is not None:
            query = query.where(FilmRoll.store_id == store_id)

    result = await db.execute(query)
    return list(result.scalars().all())


async def register_roll(
    db: AsyncSession,
    data: FilmRollCreate,
    user,
    force: bool = False,
) -> FilmRoll:
    """
    Registra uma nova bobina de película no estoque.

    Regras de negócio:
    - Verifica se existem bobinas críticas do mesmo tipo/loja (retorna 409 com header especial).
    - Se force=True, ignora o aviso e registra mesmo assim.
    - Auto-incrementa receipt_date se já existir bobina com mesma loja+tipo+tonalidade+data.
    - Salva com remaining_meters = total_meters e status = 'em_estoque'.

    Args:
        db: Sessão do banco de dados
        data: Dados da nova bobina
        user: Usuário que está registrando
        force: Se True, ignora bobinas críticas pendentes

    Raises:
        NotFoundError: Tipo de película não encontrado
        ConflictError: Bobinas críticas pendentes exigem confirmação (com header especial)
    """
    # Verificar permissão de acesso à loja
    require_resource_access(user, data.store_id, "Loja")

    # Verificar que o tipo de película existe e está ativo
    film_type_result = await db.execute(
        select(FilmType).where(
            FilmType.id == data.film_type_id,
            FilmType.is_active == True,  # noqa: E712
        )
    )
    film_type = film_type_result.scalar_one_or_none()
    if not film_type:
        raise NotFoundError(resource="Tipo de Película")

    # Verificar bobinas críticas do mesmo tipo/loja que ainda não foram esgotadas
    if not force:
        critical_result = await db.execute(
            select(FilmRoll)
            .join(FilmType, FilmRoll.film_type_id == FilmType.id)
            .options(selectinload(FilmRoll.film_type))
            .where(
                FilmRoll.store_id == data.store_id,
                FilmRoll.film_type_id == data.film_type_id,
                FilmRoll.status == "em_uso",
                FilmRoll.remaining_meters < FilmType.yellow_threshold_meters,
            )
        )
        critical_rolls = list(critical_result.scalars().all())

        if critical_rolls:
            # Retornar 409 com indicador para o frontend mostrar modal de confirmação
            critical_ids = [r.id for r in critical_rolls]
            raise ConflictError(
                detail=(
                    f"Existem {len(critical_rolls)} bobina(s) em alerta deste tipo nesta loja "
                    f"(IDs: {critical_ids}). Esgote as bobinas em alerta antes de adicionar novas, "
                    "ou confirme o cadastro."
                )
            )

    # Resolver receipt_date: auto-incrementar se já existe bobina com mesma combinação
    receipt_date = data.receipt_date
    existing_dates_result = await db.execute(
        select(FilmRoll.receipt_date).where(
            FilmRoll.store_id == data.store_id,
            FilmRoll.film_type_id == data.film_type_id,
            FilmRoll.tonality == data.tonality if data.tonality else FilmRoll.tonality.is_(None),
            FilmRoll.receipt_date == data.receipt_date,
        )
    )
    if existing_dates_result.scalar_one_or_none() is not None:
        # Já existe bobina nesta data — avançar um dia para diferenciar
        from datetime import timedelta

        receipt_date = data.receipt_date + timedelta(days=1)

    roll = FilmRoll(
        store_id=data.store_id,
        film_type_id=data.film_type_id,
        tonality=data.tonality,
        supplier=data.supplier,
        supplier_id=data.supplier_id,
        nfe_number=data.nfe_number,
        cost=data.cost,
        lot_number=data.lot_number,
        total_meters=data.total_meters,
        remaining_meters=data.total_meters,  # Inicia com 100% de estoque
        receipt_date=receipt_date,
        status="em_estoque",
    )
    db.add(roll)
    await db.flush()

    user_id = getattr(user, "id", None)
    await log_audit(
        db=db,
        action="create",
        resource_type="film_roll",
        user_id=user_id,
        resource_id=roll.id,
        new_value={
            "film_type_id": data.film_type_id,
            "tonality": data.tonality,
            "total_meters": data.total_meters,
            "receipt_date": receipt_date.isoformat(),
            "store_id": data.store_id,
        },
    )

    await db.commit()

    # Indicadores agregam bobinas cadastradas → marca para invalidar o cache de
    # analytics pós-commit (get_db lê a flag e bumpa depois que o dado persistir)
    db.info["bump_analytics"] = True

    return await _get_roll_with_type(db, roll.id)


async def _recalc_remaining_from_ledger(db: AsyncSession, roll: FilmRoll) -> float:
    """
    Recalcula ``remaining_meters`` como FONTE DA VERDADE derivada do extrato:
    ``total_meters - soma(FilmConsumption)``. Deve ser chamada SEMPRE após
    inserir/remover linhas de consumo do roll (na mesma transação, após ``flush``).

    Opção A (decisão 2026-07-30): sem clamp. Se o consumo exceder o disponível o
    saldo pode ficar negativo, sinalizando bobina mal lançada para reconciliação —
    não trava a operação.
    """
    total_consumed = (
        await db.execute(
            select(func.coalesce(func.sum(FilmConsumption.meters_consumed), 0.0)).where(
                FilmConsumption.film_roll_id == roll.id
            )
        )
    ).scalar_one()
    roll.remaining_meters = roll.total_meters - float(total_consumed)
    return roll.remaining_meters


def _recalc_roll_status(roll: FilmRoll) -> None:
    """
    Recalcula o STATUS da bobina a partir do saldo (C-03). Antes o status não
    acompanhava os metros: zerar não virava 'esgotada' e cancelar O.S. devolvia
    metros sem tirar de 'esgotada'.

    - saldo <= 0  → 'esgotada'
    - estava 'esgotada' e voltou a ter saldo (estorno/ajuste/cancelamento) → 'em_uso'

    Não mexe na distinção em_uso/em_estoque (abrir a bobina é uma ação deliberada
    via ``open_roll``), só corrige o par saldo↔esgotada.
    """
    if roll.remaining_meters <= 1e-9:
        if roll.status != "esgotada":
            roll.status = "esgotada"
    elif roll.status == "esgotada":
        roll.status = "em_uso"


async def _assert_roll_store_matches_order(
    db: AsyncSession, roll: FilmRoll, service_order_item_id: int | None
) -> None:
    """
    C-04: a bobina vinculada a uma O.S. tem que ser da MESMA loja da O.S. — exceto
    lojas com estoque compartilhado (StoreInventoryLink) ou O.S. de galpão.

    Enforcement no ponto de estrangulamento: fecha na origem a atribuição de bobina
    de loja errada, independente do caminho da tela. Vale tanto para o consumo
    (``consume_roll``) quanto para a bobina de ORIGEM do retalho (``record_scrap_use``):
    o retalho dispensa as guardas de STATUS (vem de rolo esgotado), mas continua
    preso à loja — senão o histórico de uma bobina passa a listar carros de outra.
    Não se aplica a saída avulsa (``service_order_item_id is None``).
    """
    if service_order_item_id is None:
        return

    from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
    from app.modules.stores.models import StoreInventoryLink

    os_row = (
        await db.execute(
            select(ServiceOrder.store_id, ServiceOrder.is_galpon)
            .join(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
            .where(ServiceOrderItem.id == service_order_item_id)
        )
    ).first()
    if os_row is None:
        return

    os_store_id, os_is_galpon = os_row
    if os_is_galpon or roll.store_id == os_store_id:
        return

    link_exists = (
        await db.execute(
            select(StoreInventoryLink.id).where(
                StoreInventoryLink.store_id == os_store_id,
                StoreInventoryLink.linked_store_id == roll.store_id,
            )
        )
    ).scalar_one_or_none()
    if link_exists is None:
        raise ValidationError(
            detail=(
                "Esta bobina é de outra loja e as lojas não compartilham "
                "estoque. Selecione uma bobina da loja da O.S."
            )
        )


async def consume_roll(
    db: AsyncSession,
    film_roll_id: int,
    service_order_item_id: int | None,
    meters: float,
    film_withdrawal_id: int | None = None,
) -> FilmRoll:
    """
    Desconta metros de uma bobina e registra o consumo para auditoria.

    Regras:
    1. Busca bobina com film_type eager loaded.
    2. Rejeita bobina esgotada ou lacrada (em_estoque) — só bobina aberta (em_uso) consome.
    3. Calcula cor ANTES do desconto.
    4. Decrementa remaining_meters (mínimo 0).
    5. Calcula cor DEPOIS do desconto.
    6. Se cruzou threshold (verde→amarelo ou amarelo→vermelho): dispara notificação.
    7. Cria FilmConsumption para auditoria.

    Args:
        db: Sessão do banco de dados
        film_roll_id: ID da bobina
        service_order_item_id: ID do item de O.S. que gerou o consumo (pode ser None)
        meters: Metros a descontar
        film_withdrawal_id: ID da saída avulsa que gerou o consumo (pode ser None)

    Raises:
        NotFoundError: Bobina não encontrada
        ValidationError: Bobina já esgotada
    """
    roll = await _get_roll_with_type(db, film_roll_id, for_update=True)

    if roll.status == "esgotada":
        raise ValidationError(detail="Esta bobina já está esgotada e não pode receber consumo")

    # Só bobinas abertas (em_uso) recebem consumo. Bobina lacrada (em_estoque) deve ser
    # aberta deliberadamente antes (via open_roll) — impede lançamento em bobina errada.
    if roll.status == "em_estoque":
        raise ValidationError(
            detail="Bobina está lacrada (Em Estoque). Abra a bobina antes de usar."
        )

    await _assert_roll_store_matches_order(db, roll, service_order_item_id)

    # Calcular cor antes
    color_before = get_color(roll)

    # Capturar remaining_meters antes do desconto para o audit log
    remaining_before = roll.remaining_meters

    # Registrar o consumo no extrato (fonte da verdade) e derivar o saldo dele.
    consumption = FilmConsumption(
        film_roll_id=film_roll_id,
        service_order_item_id=service_order_item_id,
        film_withdrawal_id=film_withdrawal_id,
        meters_consumed=meters,
        kind="consumo",
        created_at=datetime.now(UTC),
    )
    db.add(consumption)
    await db.flush()

    # Opção A: saldo = total - soma(extrato), SEM clamp (pode ficar negativo e
    # sinalizar bobina mal lançada). Cor recalculada sobre o novo saldo.
    new_remaining = await _recalc_remaining_from_ledger(db, roll)
    _recalc_roll_status(roll)
    color_after = get_color(roll)

    await log_audit(
        db=db,
        action="consume",
        resource_type="film_roll",
        user_id=None,
        resource_id=roll.id,
        old_value={"remaining_meters": remaining_before},
        new_value={"remaining_meters": new_remaining},
    )

    # Disparar notificação se cruzou threshold de cor (piorou)
    if color_before != color_after and color_after in ("yellow", "red"):
        try:
            await _notify_threshold_crossed(db, roll, color_after)
        except Exception:
            # Notificações são best-effort — não bloquear o consumo
            pass

    # Indicadores agregam consumo/custo desta bobina → marca para invalidar o
    # cache de analytics pós-commit (idempotente: chamado em loop por item da
    # O.S., mas o get_db só bumpa 1× por transação)
    db.info["bump_analytics"] = True

    return roll


async def release_roll_meters(
    db: AsyncSession,
    film_roll_id: int,
    service_order_item_id: int | None,
    meters: float,
    film_withdrawal_id: int | None = None,
    record_consumption: bool = True,
) -> FilmRoll:
    """
    Credita metros de volta a uma bobina (operação inversa de :func:`consume_roll`).

    Usado quando uma O.S. deixa de consumir uma bobina (ou troca de bobina) durante
    uma edição — o consumo passa a ser calculado por delta. Diferente de
    ``consume_roll``, NÃO bloqueia bobinas esgotadas: creditar metros é sempre seguro.

    Regras:
    1. Incrementa ``remaining_meters`` respeitando o teto ``total_meters``.
    2. Registra ``FilmConsumption`` com metros negativos para auditoria
       (a menos que ``record_consumption=False``).
    3. Recalcula o status (C-03): se a bobina estava 'esgotada' e volta a ter
       saldo (ex.: cancelamento de O.S.), retorna para 'em_uso'.

    Args:
        db: Sessão do banco de dados
        film_roll_id: ID da bobina
        service_order_item_id: ID do item de O.S. relacionado (pode ser None)
        meters: Metros a creditar de volta (valor positivo)
        film_withdrawal_id: ID da saída avulsa estornada (pode ser None)
        record_consumption: Quando ``False``, apenas restaura os metros SEM inserir a
            linha ``FilmConsumption`` negativa. Usado na troca de bobina de um item de
            O.S., onde a linha de consumo original é DELETADA — sem isso o histórico da
            bobina antiga ficaria com um "-Xm" órfão (Modelo/Placa em branco).
    """
    roll = await _get_roll_with_type(db, film_roll_id, for_update=True)

    remaining_before = roll.remaining_meters

    if record_consumption:
        consumption = FilmConsumption(
            film_roll_id=film_roll_id,
            service_order_item_id=service_order_item_id,
            film_withdrawal_id=film_withdrawal_id,
            meters_consumed=-meters,
            kind="estorno",
            created_at=datetime.now(UTC),
        )
        db.add(consumption)

    await db.flush()
    # Saldo derivado do extrato. Com record_consumption=False (troca de bobina), o
    # caller já removeu a linha original; recalcular reflete essa remoção.
    new_remaining = await _recalc_remaining_from_ledger(db, roll)
    _recalc_roll_status(roll)

    await log_audit(
        db=db,
        action="release",
        resource_type="film_roll",
        user_id=None,
        resource_id=roll.id,
        old_value={"remaining_meters": remaining_before},
        new_value={"remaining_meters": new_remaining},
    )

    # Indicadores agregam consumo/custo desta bobina → marca para invalidar o
    # cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True

    return roll


async def release_item_consumption(
    db: AsyncSession, service_order_item_id: int, film_roll_id: int
) -> float:
    """
    Estorna o consumo (kind='consumo') de UM item de O.S. numa bobina: apaga as
    linhas do extrato e devolve os metros SEM inserir estorno negativo (o
    histórico simplesmente deixa de mostrar aquele consumo). Retorna os metros
    devolvidos.

    Usado quando um serviço já debitado passa a ser retalho no Finalizar — os
    metros que a marcação existe para não gastar voltam para a bobina. Não mexe
    em linhas de retalho (0m) nem em ajustes: filtra por ``kind == 'consumo'``.
    """
    rows = (
        await db.execute(
            select(FilmConsumption.id, FilmConsumption.meters_consumed).where(
                FilmConsumption.service_order_item_id == service_order_item_id,
                FilmConsumption.film_roll_id == film_roll_id,
                FilmConsumption.kind == "consumo",
            )
        )
    ).all()
    if not rows:
        return 0.0
    net = float(sum(m for (_cid, m) in rows))
    await db.execute(
        FilmConsumption.__table__.delete().where(
            FilmConsumption.id.in_([cid for (cid, _m) in rows])
        )
    )
    if net > 1e-9:
        await release_roll_meters(db, film_roll_id, None, net, record_consumption=False)
    return net


async def record_scrap_use(
    db: AsyncSession,
    film_roll_id: int,
    service_order_item_id: int | None,
) -> None:
    """
    Registra no extrato que um serviço foi feito com RETALHO desta bobina.

    Movimento de 0m (``kind='retalho'``): o pedaço já foi debitado lá atrás,
    quando o carro de origem consumiu os metros de tabela — descontar de novo é
    justamente o que zerava a bobina antes da hora. A linha existe só para o
    histórico da bobina mostrar o carro que aproveitou a sobra.

    Diferente de :func:`consume_roll`, NÃO passa pelas guardas de status: o
    retalho costuma vir de bobina antiga, já 'esgotada'. Como o saldo é derivado
    do extrato e a linha vale 0m, saldo e status ficam intactos. A trava de LOJA
    (C-04), porém, continua valendo — a bobina de origem tem que ser da loja da
    O.S., senão o extrato de uma loja passa a listar carros de outra.
    """
    roll = await _get_roll_with_type(db, film_roll_id)
    await _assert_roll_store_matches_order(db, roll, service_order_item_id)
    db.add(
        FilmConsumption(
            film_roll_id=roll.id,
            service_order_item_id=service_order_item_id,
            meters_consumed=0.0,
            kind="retalho",
            created_at=datetime.now(UTC),
        )
    )
    await db.flush()

    # Indicadores agregam uso de retalho desta bobina → marca para invalidar o
    # cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True


# Freio contra "marcar retalho sempre para a bobina nunca zerar": alerta quando o
# instalador passa desta fatia de serviços de película feitos com retalho no mês.
SCRAP_ALERT_RATIO = 0.40
SCRAP_ALERT_MIN_SERVICES = 10
FILM_DEPARTMENTS = ("film", "security_film", "ppf")


async def notify_scrap_ratio_if_crossed(db: AsyncSession, service_order_id: int) -> None:
    """
    Avisa os Owners quando um instalador CRUZA o limiar de uso de retalho no mês.

    Só dispara na transição (estava abaixo do limiar antes desta O.S., ficou
    acima depois) — mesmo padrão de :func:`_notify_threshold_crossed`, evitando
    repetir a notificação a cada carro sem precisar de tabela de controle.
    """
    from sqlalchemy import case

    from app.modules.auth.models import User
    from app.modules.employees.models import Employee
    from app.modules.notifications.service import create_notification
    from app.modules.service_orders.models import (
        ServiceOrder,
        ServiceOrderItem,
        ServiceOrderWorker,
    )

    now_local = datetime.now(TZ_LOCAL)
    month_start = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(
        UTC
    )

    async def _counts(only_this_order: bool) -> dict[int, tuple[int, int]]:
        query = (
            select(
                ServiceOrderWorker.employee_id,
                func.count(ServiceOrderItem.id),
                func.count(case((ServiceOrderItem.used_scrap, 1))),
            )
            .join(
                ServiceOrderItem,
                ServiceOrderItem.id == ServiceOrderWorker.service_order_item_id,
            )
            .join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
            .where(
                ServiceOrder.status == "completed",
                ServiceOrder.department.in_(FILM_DEPARTMENTS),
                ServiceOrder.completion_time >= month_start,
            )
            .group_by(ServiceOrderWorker.employee_id)
        )
        if only_this_order:
            query = query.where(ServiceOrderItem.service_order_id == service_order_id)
        rows = await db.execute(query)
        return {emp_id: (int(total), int(scrap)) for emp_id, total, scrap in rows.all()}

    deltas = await _counts(only_this_order=True)
    if not deltas:
        return
    totals = await _counts(only_this_order=False)

    crossed: list[tuple[int, int, int]] = []  # (employee_id, scrap, total)
    for employee_id, (delta_total, delta_scrap) in deltas.items():
        total_now, scrap_now = totals.get(employee_id, (0, 0))
        if total_now < SCRAP_ALERT_MIN_SERVICES:
            continue
        if scrap_now / total_now < SCRAP_ALERT_RATIO:
            continue
        total_before = total_now - delta_total
        scrap_before = scrap_now - delta_scrap
        was_above = (
            total_before >= SCRAP_ALERT_MIN_SERVICES
            and total_before > 0
            and scrap_before / total_before >= SCRAP_ALERT_RATIO
        )
        if not was_above:
            crossed.append((employee_id, scrap_now, total_now))

    if not crossed:
        return

    name_rows = (
        await db.execute(
            select(Employee.id, Employee.name).where(Employee.id.in_([c[0] for c in crossed]))
        )
    ).all()
    names: dict[int, str] = {int(emp_id): name for emp_id, name in name_rows}
    owners = list(
        (
            await db.execute(
                select(User).where(User.role == "owner", User.is_active == True)  # noqa: E712
            )
        )
        .scalars()
        .all()
    )
    order = (
        await db.execute(select(ServiceOrder).where(ServiceOrder.id == service_order_id))
    ).scalar_one_or_none()
    is_galpon = bool(order.is_galpon) if order else False

    for employee_id, scrap_count, total_count in crossed:
        employee_name = names.get(employee_id, f"Instalador #{employee_id}")
        percent = round(scrap_count / total_count * 100)
        for owner in owners:
            await create_notification(
                db=db,
                user_id=owner.id,
                type="warning",
                title="Uso de retalho acima do normal",
                body=(
                    f"{employee_name} marcou {scrap_count} de {total_count} serviços de "
                    f"película como retalho neste mês ({percent}%). Vale conferir se as "
                    f"bobinas estão sendo debitadas corretamente."
                ),
                is_galpon=is_galpon,
            )


def _roll_notification_label(roll: FilmRoll) -> str:
    """
    Monta descrição legível e rastreável da bobina para uso em notificações.

    Usa os mesmos componentes do SMART ID (tipo, tonalidade, data, metros,
    loja), mas em formato de leitura humana — sem underscores.

    Formato: "Bobina {tipo}{ tonalidade} · {DD/MM/AAAA} [{metros}m] ({loja})"
    Ex.: "Bobina WindowBlue G20 · 31/08/2026 [30m] (Hyundai Unidade 10)"
    """
    film_type_name = roll.film_type.name if roll.film_type else "Desconhecido"
    tonality_str = f" {roll.tonality}" if roll.tonality else ""
    date_str = roll.receipt_date.strftime("%d/%m/%Y")
    meters = int(roll.total_meters)
    store_name = roll.store.name if roll.store else f"Loja #{roll.store_id}"
    return f"Bobina {film_type_name}{tonality_str} · {date_str} [{meters}m] ({store_name})"


async def _notify_threshold_crossed(db: AsyncSession, roll: FilmRoll, new_color: str) -> None:
    """
    Dispara notificação quando bobina cruzou limiar de estoque.

    Args:
        db: Sessão do banco de dados
        roll: Bobina que cruzou o limiar
        new_color: Nova cor da bobina (yellow ou red)
    """
    from sqlalchemy import select as sa_select

    from app.modules.auth.models import User
    from app.modules.notifications.service import create_notification
    from app.modules.stores.models import Store

    # Notificar usuários com acesso a esta loja (role OWNER)
    owners_result = await db.execute(
        sa_select(User).where(User.role == "owner", User.is_active == True)  # noqa: E712
    )
    owners = list(owners_result.scalars().all())

    roll_label = _roll_notification_label(roll)

    if new_color == "yellow":
        title = "Estoque de Película Baixo"
        body = f"{roll_label} está com estoque baixo: {roll.remaining_meters:.1f}m restantes."
        notif_type = "warning"
    else:  # red
        title = "Estoque de Película Crítico"
        body = (
            f"{roll_label} está em nível crítico: "
            f"{roll.remaining_meters:.1f}m restantes. Considere repor o estoque."
        )
        notif_type = "alert"

    # Determinar se a bobina é da loja galpão
    is_roll_galpon = False
    galpon_store_result = await db.execute(
        sa_select(Store).where(Store.is_galpon_store == True).limit(1)  # noqa: E712
    )
    galpon_store = galpon_store_result.scalar_one_or_none()
    if galpon_store and roll.store_id == galpon_store.id:
        is_roll_galpon = True

    for owner in owners:
        await create_notification(
            db=db,
            user_id=owner.id,
            type=notif_type,
            title=title,
            body=body,
            is_galpon=is_roll_galpon,
            related_url=f"/estoque?roll={roll.id}",
        )


async def exhaust_roll(db: AsyncSession, film_roll_id: int, user) -> FilmRoll:
    """
    Marca uma bobina como esgotada manualmente.

    Args:
        db: Sessão do banco de dados
        film_roll_id: ID da bobina
        user: Usuário que está esgotando

    Raises:
        NotFoundError: Bobina não encontrada ou sem permissão
    """
    roll = await _get_roll_with_type(db, film_roll_id, for_update=True)
    require_resource_access(user, roll.store_id, "Bobina")

    old_status = roll.status
    roll.status = "esgotada"
    await db.flush()

    await log_audit(
        db=db,
        action="exhaust",
        resource_type="film_roll",
        user_id=getattr(user, "id", None),
        resource_id=roll.id,
        old_value={"status": old_status},
        new_value={"status": "esgotada"},
    )

    await db.commit()

    return await _get_roll_with_type(db, film_roll_id)


async def restore_roll(db: AsyncSession, film_roll_id: int, user) -> FilmRoll:
    """Restaura uma bobina esgotada para em_uso ou em_estoque."""
    roll = await _get_roll_with_type(db, film_roll_id)
    require_resource_access(user, roll.store_id, "Bobina")

    if roll.status != "esgotada":
        raise ValidationError("Apenas bobinas esgotadas podem ser restauradas.")

    new_status = "em_estoque" if roll.remaining_meters >= roll.total_meters else "em_uso"
    roll.status = new_status
    await db.flush()

    await log_audit(
        db=db,
        action="restore",
        resource_type="film_roll",
        user_id=getattr(user, "id", None),
        resource_id=roll.id,
        old_value={"status": "esgotada"},
        new_value={"status": new_status},
    )

    await db.commit()
    return await _get_roll_with_type(db, film_roll_id)


async def open_roll(db: AsyncSession, film_roll_id: int, user) -> FilmRoll:
    """
    Abre uma bobina para uso: transição deliberada em_estoque→em_uso.

    Só bobinas 'em_estoque' (lacradas) podem ser abertas. Abrir uma bobina é a
    condição para que ela possa receber consumo (ver guarda em :func:`consume_roll`),
    e a ação é auditada. NÃO altera metros.

    Args:
        db: Sessão do banco de dados
        film_roll_id: ID da bobina
        user: Usuário que está abrindo a bobina

    Raises:
        NotFoundError: Bobina não encontrada ou sem permissão
        ValidationError: Bobina não está em estoque
    """
    roll = await _get_roll_with_type(db, film_roll_id, for_update=True)
    require_resource_access(user, roll.store_id, "Bobina")

    if roll.status != "em_estoque":
        raise ValidationError(detail="Bobina não está em estoque")

    roll.status = "em_uso"
    await db.flush()

    await log_audit(
        db=db,
        action="roll_open",
        resource_type="film_roll",
        user_id=getattr(user, "id", None),
        resource_id=roll.id,
        old_value={"status": "em_estoque"},
        new_value={"status": "em_uso"},
    )

    await db.commit()

    # Indicadores agregam status/estoque desta bobina → marca para invalidar o
    # cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True

    return await _get_roll_with_type(db, film_roll_id)


async def adjust_roll_meters(
    db: AsyncSession,
    film_roll_id: int,
    new_remaining: float,
    user,
    note: str | None = None,
) -> FilmRoll:
    """
    Ajusta os metros restantes de uma bobina para bater com a contagem física
    (conferência de estoque). Auditado.

    Opção A (2026-07-30): NÃO sobrescreve o saldo. Lança um MOVIMENTO de ajuste no
    extrato (FilmConsumption kind='ajuste') com o delta e o MOTIVO obrigatório, e
    deriva ``remaining_meters`` do extrato. Assim saldo e extrato nunca descolam e
    todo ajuste fica rastreável (quem/quando/porquê).

    Args:
        db: Sessão do banco de dados
        film_roll_id: ID da bobina
        new_remaining: Metros restantes reais (0 <= x <= total_meters)
        user: Usuário que está ajustando
        note: Motivo do ajuste (OBRIGATÓRIO — por que o saldo foi corrigido)

    Raises:
        NotFoundError: Bobina não encontrada ou sem permissão
        ValidationError: Motivo vazio, ou valor fora do intervalo [0, total_meters]
    """
    roll = await _get_roll_with_type(db, film_roll_id, for_update=True)
    require_resource_access(user, roll.store_id, "Bobina")

    if not note or not note.strip():
        raise ValidationError(detail="Informe o motivo do ajuste de estoque.")
    reason = note.strip()

    if new_remaining < 0 or new_remaining > roll.total_meters:
        raise ValidationError(detail=f"Metros restantes deve estar entre 0 e {roll.total_meters}.")

    old_remaining = roll.remaining_meters
    # delta > 0 baixa o saldo (consumiu a mais que o registrado); delta < 0 devolve.
    delta = old_remaining - float(new_remaining)
    if abs(delta) > 1e-9:
        db.add(
            FilmConsumption(
                film_roll_id=roll.id,
                meters_consumed=delta,
                kind="ajuste",
                adjustment_reason=reason,
                created_at=datetime.now(UTC),
            )
        )
        await db.flush()
        await _recalc_remaining_from_ledger(db, roll)
        _recalc_roll_status(roll)

    await log_audit(
        db=db,
        action="roll_adjust_meters",
        resource_type="film_roll",
        user_id=getattr(user, "id", None),
        resource_id=roll.id,
        old_value={"remaining_meters": old_remaining},
        new_value={"remaining_meters": roll.remaining_meters, "note": reason},
    )

    await db.commit()

    # Indicadores agregam metros/saldo desta bobina → marca para invalidar o
    # cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True

    return await _get_roll_with_type(db, film_roll_id)


async def update_roll(db: AsyncSession, film_roll_id: int, data, user) -> FilmRoll:
    """Edita os dados de uma bobina (tipo, tonalidade, fornecedor, NF, custo, lote,
    data de recebimento, metros totais).

    Não mexe diretamente no saldo: alterar ``total_meters`` recalcula
    ``remaining_meters`` a partir do extrato (preservando o já consumido) e
    ressincroniza o status. Auditado.
    """
    roll = await _get_roll_with_type(db, film_roll_id, for_update=True)
    require_resource_access(user, roll.store_id, "Bobina")

    old_value = {
        "film_type_id": roll.film_type_id,
        "tonality": roll.tonality,
        "supplier": roll.supplier,
        "supplier_id": roll.supplier_id,
        "nfe_number": roll.nfe_number,
        "cost": float(roll.cost) if roll.cost is not None else None,
        "lot_number": roll.lot_number,
        "total_meters": roll.total_meters,
        "receipt_date": roll.receipt_date.isoformat(),
    }

    if data.film_type_id is not None and data.film_type_id != roll.film_type_id:
        film_type = (
            await db.execute(
                select(FilmType).where(
                    FilmType.id == data.film_type_id,
                    FilmType.is_active == True,  # noqa: E712
                )
            )
        ).scalar_one_or_none()
        if not film_type:
            raise NotFoundError(resource="Tipo de Película")
        roll.film_type_id = data.film_type_id

    if data.tonality is not None:
        roll.tonality = data.tonality

    if data.clear_supplier:
        roll.supplier = None
        roll.supplier_id = None
    else:
        if data.supplier is not None:
            roll.supplier = data.supplier
        if data.supplier_id is not None:
            roll.supplier_id = data.supplier_id

    if data.clear_nfe:
        roll.nfe_number = None
    elif data.nfe_number is not None:
        roll.nfe_number = data.nfe_number

    if data.clear_cost:
        roll.cost = None
    elif data.cost is not None:
        roll.cost = data.cost

    if data.clear_lot:
        roll.lot_number = None
    elif data.lot_number is not None:
        roll.lot_number = data.lot_number

    if data.receipt_date is not None:
        roll.receipt_date = data.receipt_date

    if data.total_meters is not None and data.total_meters != roll.total_meters:
        roll.total_meters = data.total_meters
        await db.flush()
        await _recalc_remaining_from_ledger(db, roll)
        _recalc_roll_status(roll)

    await db.flush()
    await log_audit(
        db=db,
        action="roll_update",
        resource_type="film_roll",
        user_id=getattr(user, "id", None),
        resource_id=roll.id,
        old_value=old_value,
        new_value={
            "film_type_id": roll.film_type_id,
            "tonality": roll.tonality,
            "supplier": roll.supplier,
            "supplier_id": roll.supplier_id,
            "nfe_number": roll.nfe_number,
            "cost": float(roll.cost) if roll.cost is not None else None,
            "lot_number": roll.lot_number,
            "total_meters": roll.total_meters,
            "receipt_date": roll.receipt_date.isoformat(),
        },
    )
    await db.commit()

    # Indicadores agregam custo/metadados desta bobina → marca para invalidar o
    # cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True

    return await _get_roll_with_type(db, film_roll_id)


async def list_consumptions(
    db: AsyncSession,
    film_roll_id: int,
    user,
) -> list[dict]:
    """
    Lista os registros de consumo de uma bobina com modelo e placa do veículo.

    Faz join com service_order_items → service_orders para trazer
    vehicle_model e vehicle_plate de cada O.S. associada ao consumo.

    Args:
        db: Sessão do banco de dados
        film_roll_id: ID da bobina
        user: Usuário atual (verifica permissão de acesso à loja)

    Returns:
        Lista de dicts com campos do FilmConsumption + vehicle_model + plate,
        ordenada por created_at DESC

    Raises:
        NotFoundError: Bobina não encontrada ou sem permissão
    """
    from app.modules.employees.models import Employee
    from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem

    # Verificar acesso
    await get_roll(db, film_roll_id, user)

    result = await db.execute(
        select(
            FilmConsumption.id,
            FilmConsumption.film_roll_id,
            FilmConsumption.service_order_item_id,
            FilmConsumption.film_withdrawal_id,
            FilmConsumption.meters_consumed,
            FilmConsumption.kind,
            FilmConsumption.adjustment_reason,
            FilmConsumption.created_at,
            ServiceOrder.vehicle_model,
            ServiceOrder.vehicle_plate.label("plate"),
            ServiceOrder.completion_time,
            Employee.name.label("withdrawal_employee_name"),
        )
        .outerjoin(
            ServiceOrderItem,
            ServiceOrderItem.id == FilmConsumption.service_order_item_id,
        )
        .outerjoin(
            ServiceOrder,
            ServiceOrder.id == ServiceOrderItem.service_order_id,
        )
        .outerjoin(
            FilmWithdrawal,
            FilmWithdrawal.id == FilmConsumption.film_withdrawal_id,
        )
        .outerjoin(
            Employee,
            Employee.id == FilmWithdrawal.employee_id,
        )
        .where(FilmConsumption.film_roll_id == film_roll_id)
        # A "Data" exibida é o completion_time da O.S. quando existe (ver abaixo). A
        # ordenação segue a MESMA data efetiva — senão uma correção retroativa (linha
        # inserida hoje, mas datada na finalização antiga) desalinharia a lista "mais
        # recente primeiro".
        .order_by(func.coalesce(ServiceOrder.completion_time, FilmConsumption.created_at).desc())
    )
    history: list[dict] = []
    for row in result.all():
        data = row._asdict()
        # A "Data" do histórico representa QUANDO a película foi usada no carro, não
        # quando a linha do extrato foi inserida. Ao corrigir uma O.S. finalizada com a
        # bobina errada (troca pós-finalização), a linha nasce no dia da correção, mas o
        # uso real é a finalização da O.S. — datamos pelo completion_time (ADR 0014).
        # Saídas avulsas e ajustes manuais não têm O.S.: mantêm o created_at do movimento.
        completion_time = data.pop("completion_time", None)
        if completion_time is not None:
            data["created_at"] = completion_time
        history.append(data)
    return history


async def transfer_film_roll(
    db: AsyncSession,
    roll_id: int,
    target_store_id: int,
    current_user,
) -> FilmRoll:
    """
    Transfere uma bobina de película para outra loja.

    Regras de negócio:
    - Bobinas 'em_estoque' OU 'em_uso' podem ser transferidas (a bobina
      parcialmente usada viaja com os metros restantes e mantém o histórico
      de consumo; as O.S. da loja de origem continuam referenciando-a).
    - Bobinas 'esgotada' não podem ser transferidas (restaurar antes, se for o caso).
    - A loja de destino deve existir e estar ativa.
    - A loja de destino deve ser diferente da loja atual.
    - O usuário deve ter acesso à loja de origem da bobina.

    Args:
        db: Sessão do banco de dados
        roll_id: ID da bobina a ser transferida
        target_store_id: ID da loja de destino
        current_user: Usuário realizando a transferência

    Raises:
        NotFoundError: Bobina não encontrada, sem permissão, ou loja de destino não encontrada
        HTTPException 400: Bobina esgotada ou loja de destino é a mesma
    """
    from fastapi import HTTPException

    from app.modules.stores.models import Store

    # 1 + 2. Buscar a bobina (lança NotFoundError se não existe)
    roll = await _get_roll_with_type(db, roll_id)

    # 3. Verificar que o usuário tem acesso à loja da bobina
    require_resource_access(current_user, roll.store_id, "Bobina")

    # 4. Bobina esgotada não é transferível (sem metros para movimentar)
    if roll.status == "esgotada":
        raise HTTPException(
            status_code=400,
            detail=(
                "Bobina esgotada não pode ser transferida. "
                "Restaure a bobina antes, se ela ainda tiver metros."
            ),
        )

    # 5. Buscar loja de destino
    store_result = await db.execute(
        select(Store).where(Store.id == target_store_id, Store.is_active == True)  # noqa: E712
    )
    target_store = store_result.scalar_one_or_none()
    if not target_store:
        raise NotFoundError(resource="Loja de destino")

    # 6. Verificar que a loja de destino é diferente da loja atual
    if roll.store_id == target_store_id:
        raise HTTPException(
            status_code=400,
            detail="A loja de destino deve ser diferente da loja atual da bobina.",
        )

    origin_store_id = roll.store_id

    # 7. Atualizar store_id
    roll.store_id = target_store_id

    db.add(roll)
    await db.flush()

    await log_audit(
        db=db,
        action="transfer",
        resource_type="film_roll",
        user_id=getattr(current_user, "id", None),
        resource_id=roll.id,
        # status/metros no momento da transferência: rastreia bobinas que
        # mudaram de loja já parcialmente usadas
        old_value={
            "store_id": origin_store_id,
            "status": roll.status,
            "remaining_meters": roll.remaining_meters,
        },
        new_value={"store_id": target_store_id},
    )

    # 8. Persistir e recarregar com relacionamentos
    await db.commit()

    return await _get_roll_with_type(db, roll.id)


async def get_meters_for_service(
    db: AsyncSession, film_type_id: int, service_id: int
) -> float | None:
    """
    Retorna os metros consumidos por um serviço específico para um tipo de película.

    Args:
        db: Sessão do banco de dados
        film_type_id: ID do tipo de película
        service_id: ID do serviço

    Returns:
        Metros configurados, ou None se não houver associação
    """
    result = await db.execute(
        select(FilmTypeService.meters_consumed).where(
            FilmTypeService.film_type_id == film_type_id,
            FilmTypeService.service_id == service_id,
        )
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Film Roll — Hard Delete (HML-139)
# ---------------------------------------------------------------------------


async def delete_film_roll(
    db: AsyncSession,
    film_roll_id: int,
    user,
) -> None:
    """
    Exclui permanentemente uma bobina do estoque.

    Bloqueia se existirem registros de consumo vinculados (carros que usaram a bobina).

    Raises:
        NotFoundError: Bobina não encontrada (ou fora do escopo de loja do usuário)
        ConflictError: Bobina possui consumos registrados
    """
    roll = await _get_roll_with_type(db, film_roll_id)
    # Escopo de loja: só exclui bobina de loja à qual o usuário tem acesso
    require_resource_access(user, roll.store_id, "Bobina")

    consumption_count_result = await db.execute(
        select(func.count(FilmConsumption.id)).where(FilmConsumption.film_roll_id == film_roll_id)
    )
    consumption_count = consumption_count_result.scalar_one()

    if consumption_count > 0:
        raise ConflictError(
            detail=(
                f"Não é possível excluir: esta bobina possui {consumption_count} "
                "registro(s) de consumo vinculado(s)."
            )
        )

    await log_audit(
        db=db,
        action="delete",
        resource_type="film_roll",
        user_id=user.id,
        resource_id=film_roll_id,
        old_value={
            "film_type_id": roll.film_type_id,
            "store_id": roll.store_id,
            "total_meters": roll.total_meters,
            "status": roll.status,
        },
    )

    await db.delete(roll)
    await db.flush()
    await db.commit()


# ---------------------------------------------------------------------------
# Film Type Forecast (HML-90)
# ---------------------------------------------------------------------------


def _classify_tonality_status(
    consumed: float,
    available: float,
    red_thresh: float,
    yellow_thresh: float,
) -> str:
    """Classifica o status de uma tonalidade com base no balanço de estoque."""
    if available == 0:
        return "critical" if consumed > 0 else "ok"
    balance = available - consumed
    if balance < 0:
        return "critical" if abs(balance) >= red_thresh else "attention"
    if balance == 0 and consumed > 0:
        return "critical"
    return "attention" if available < yellow_thresh else "ok"


async def get_film_type_forecast(
    db: AsyncSession,
    film_type_id: int,
    store_id: int,
) -> dict:
    """
    Calcula a previsão de consumo de um tipo de película em uma loja.

    Agrega:
    - O.S. em 'waiting' ou 'in_progress' que possuem itens com film_type_id correspondente
    - Agendamentos em 'scheduled' ou 'in_progress' com film_type_id correspondente

    Retorna dados agrupados por tonalidade (HML-155).

    Returns:
        Dict com items, total_scheduled_meters, available_meters, will_exhaust,
        film_type_name, tonalities, KPI counts.
    """
    from collections import defaultdict

    from app.modules.scheduling.models import Appointment
    from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
    from app.modules.services.models import Service  # noqa: F401 — used in join
    from app.modules.stores.models import Store

    # --- Buscar FilmType para nome e thresholds ---
    film_type_result = await db.execute(select(FilmType).where(FilmType.id == film_type_id))
    film_type = film_type_result.scalar_one_or_none()
    if not film_type:
        from app.core.exceptions import NotFoundError

        raise NotFoundError(resource="Tipo de Película")

    yellow_threshold = float(film_type.yellow_threshold_meters or 0.0)
    red_threshold = float(film_type.red_threshold_meters or 0.0)

    # --- Expandir para lojas parceiras (estoque compartilhado) ---
    store_result = await db.execute(
        select(Store).options(selectinload(Store.inventory_links)).where(Store.id == store_id)
    )
    target_store = store_result.scalar_one_or_none()
    if target_store and target_store.has_shared_inventory and target_store.inventory_links:
        partner_ids = [link.linked_store_id for link in target_store.inventory_links]
        all_store_ids = [store_id] + partner_ids
    else:
        all_store_ids = [store_id]

    store_filter = (
        ServiceOrder.store_id.in_(all_store_ids)
        if len(all_store_ids) > 1
        else ServiceOrder.store_id == store_id
    )
    appt_store_filter = (
        Appointment.store_id.in_(all_store_ids)
        if len(all_store_ids) > 1
        else Appointment.store_id == store_id
    )
    roll_store_filter = (
        FilmRoll.store_id.in_(all_store_ids)
        if len(all_store_ids) > 1
        else FilmRoll.store_id == store_id
    )

    # --- Query de O.S. abertas (inclui tonalidade do item) ---
    # Usa COALESCE(ServiceOrderItem.tonality, FilmRoll.tonality) para cobrir casos
    # onde o campo tonality do item é NULL mas a bobina vinculada possui tonalidade.
    result = await db.execute(
        select(
            ServiceOrder.id.label("service_order_id"),
            ServiceOrder.vehicle_model,
            ServiceOrder.vehicle_plate,
            Service.name.label("service_name"),
            FilmTypeService.meters_consumed,
            func.coalesce(ServiceOrderItem.tonality, FilmRoll.tonality).label("item_tonality"),
        )
        .join(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .outerjoin(
            FilmTypeService,
            (FilmTypeService.film_type_id == ServiceOrderItem.film_type_id)
            & (FilmTypeService.service_id == ServiceOrderItem.service_id),
        )
        .outerjoin(Service, Service.id == ServiceOrderItem.service_id)
        .outerjoin(FilmRoll, FilmRoll.id == ServiceOrderItem.film_roll_id)
        .where(
            ServiceOrderItem.film_type_id == film_type_id,
            store_filter,
            ServiceOrder.status.in_(["waiting", "in_progress"]),
        )
        .order_by(ServiceOrder.id)
    )

    rows = result.all()

    items = [
        {
            "service_order_id": row.service_order_id,
            "appointment_id": None,
            "vehicle_model": row.vehicle_model,
            "vehicle_plate": row.vehicle_plate,
            "service_name": row.service_name,
            "meters_consumed": float(row.meters_consumed or 0.0),
            "tonality": row.item_tonality,
        }
        for row in rows
    ]

    # --- Query de Agendamentos pendentes ---
    # Os agendamentos NÃO armazenam film_type_id diretamente no registro raiz;
    # os serviços ficam em service_ids (JSON). Por isso buscamos via FilmTypeService:
    # quais service_ids estão vinculados ao film_type_id solicitado.
    service_info_result = await db.execute(
        select(
            FilmTypeService.service_id,
            FilmTypeService.meters_consumed,
            Service.name.label("service_name"),
        )
        .join(Service, Service.id == FilmTypeService.service_id)
        .where(FilmTypeService.film_type_id == film_type_id)
    )
    service_info_rows = service_info_result.all()
    service_meters_map = {
        row.service_id: float(row.meters_consumed or 0.0) for row in service_info_rows
    }
    service_name_map = {row.service_id: row.service_name for row in service_info_rows}
    service_ids_for_type = list(service_meters_map.keys())

    if service_ids_for_type:
        from sqlalchemy.dialects.postgresql import JSONB as JSONB_TYPE

        # Filtra agendamentos cujo service_ids JSON contém ao menos um serviço do tipo
        service_id_filters = [
            cast(Appointment.service_ids, JSONB_TYPE).contains([sid])
            for sid in service_ids_for_type
        ]

        scheduling_result = await db.execute(
            select(
                Appointment.id.label("appointment_id"),
                Appointment.vehicle_model,
                Appointment.vehicle_plate,
                Appointment.service_ids,
                Appointment.film_tonality,
                Appointment.film_entries,
            )
            .where(
                or_(
                    Appointment.film_type_id == film_type_id,  # compatibilidade legada
                    or_(*service_id_filters),
                ),
                appt_store_filter,
                Appointment.status.in_(["scheduled", "in_progress"]),
            )
            .order_by(Appointment.id)
        )

        scheduling_rows = scheduling_result.all()

        scheduling_items = []
        for row in scheduling_rows:
            appt_service_ids: list[int] = row.service_ids or []
            film_entries_list = row.film_entries or []
            entry_tonality_map = {
                fe.get("service_id"): fe.get("tonality")
                for fe in film_entries_list
                if fe.get("service_id")
            }

            for sid in appt_service_ids:
                if sid not in service_meters_map:
                    continue
                tonality = entry_tonality_map.get(sid) or row.film_tonality
                scheduling_items.append(
                    {
                        "service_order_id": None,
                        "appointment_id": row.appointment_id,
                        "vehicle_model": row.vehicle_model,
                        "vehicle_plate": row.vehicle_plate,
                        "service_name": service_name_map.get(sid, "Agendamento"),
                        "meters_consumed": service_meters_map[sid],
                        "tonality": tonality,
                    }
                )
    else:
        scheduling_items = []

    all_items = items + scheduling_items
    total_scheduled = sum(item["meters_consumed"] for item in all_items)

    # --- Estoque agrupado por tonalidade ---
    stock_result = await db.execute(
        select(
            FilmRoll.tonality,
            func.coalesce(func.sum(FilmRoll.remaining_meters), 0.0).label("available"),
        )
        .where(
            FilmRoll.film_type_id == film_type_id,
            roll_store_filter,
            FilmRoll.status != "esgotada",
        )
        .group_by(FilmRoll.tonality)
    )
    stock_by_tonality: dict[str | None, float] = {
        row.tonality: float(row.available) for row in stock_result.all()
    }
    total_available = sum(stock_by_tonality.values())

    # --- Agrupar itens por tonalidade ---
    items_by_tonality: dict[str | None, list[dict]] = defaultdict(list)
    for item in all_items:
        items_by_tonality[item.get("tonality")].append(item)

    # --- Construir detalhe por tonalidade ---
    # Apenas tonalidades com bobinas cadastradas no estoque geram cards.
    # Itens cujo tonality não bate com nenhuma tonalidade em estoque são
    # separados em unattributed_items para alerta no frontend.
    attributed_tonalities: set[str | None] = set(stock_by_tonality.keys())

    tonality_details = []
    for key in sorted(stock_by_tonality.keys(), key=lambda t: (t is None, t or "")):
        available = stock_by_tonality.get(key, 0.0)
        ton_items = list(items_by_tonality.get(key, []))
        consumed = sum(i["meters_consumed"] for i in ton_items)
        balance = available - consumed
        usage_pct = (consumed / available * 100) if available > 0 else 0.0
        status = _classify_tonality_status(consumed, available, red_threshold, yellow_threshold)
        tonality_details.append(
            {
                "tonality": key,
                "available_meters": available,
                "consumed_meters": consumed,
                "balance_meters": balance,
                "scheduled_orders_count": len(ton_items),
                "usage_percentage": min(usage_pct, 9999.0),
                "status": status,
                "items": ton_items,
            }
        )

    # Itens sem tonalidade definida ou com tonalidade fora do estoque cadastrado
    unattributed_items = [
        item for item in all_items if item.get("tonality") not in attributed_tonalities
    ]
    unattributed_meters = sum(i["meters_consumed"] for i in unattributed_items)

    # --- KPIs ---
    return {
        "film_type_id": film_type_id,
        "store_id": store_id,
        "items": all_items,
        "total_scheduled_meters": total_scheduled,
        "available_meters": total_available,
        "will_exhaust": total_scheduled > 0 and total_scheduled > total_available,
        # HML-155
        "film_type_name": film_type.name,
        "tonalities": tonality_details,
        "tonalities_analyzed": len(tonality_details),
        "tonalities_attention_count": sum(
            1 for t in tonality_details if t["status"] == "attention"
        ),
        "tonalities_critical_count": sum(1 for t in tonality_details if t["status"] == "critical"),
        "unattributed_items": unattributed_items,
        "unattributed_meters": unattributed_meters,
    }


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------


async def list_rolls_for_export(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    film_type_id: int | None = None,
    status: str | None = None,
    department: str | None = None,
) -> list[FilmRoll]:
    """
    Lista todas as bobinas (sem paginação) para geração de Excel.
    Carrega film_type, store e consumptions via eager load.
    """
    query = select(FilmRoll).options(
        selectinload(FilmRoll.film_type),
        selectinload(FilmRoll.store),
        selectinload(FilmRoll.supplier_rel),
        selectinload(FilmRoll.consumptions),
    )

    query = apply_store_filter(query, user, FilmRoll.store_id)

    if store_id is not None:
        query = query.where(FilmRoll.store_id == store_id)
    if film_type_id is not None:
        query = query.where(FilmRoll.film_type_id == film_type_id)
    if status is not None:
        query = query.where(FilmRoll.status == status)
    if department is not None:
        query = query.where(
            FilmRoll.film_type_id.in_(select(FilmType.id).where(FilmType.department == department))
        )

    query = query.order_by(FilmRoll.receipt_date.desc()).limit(50001)
    result = await db.execute(query)
    rolls = list(result.scalars().all())
    if len(rolls) > 50000:
        raise ValidationError(
            detail="Export limitado a 50.000 registros. Aplique filtros adicionais para reduzir o volume."
        )
    return rolls[:50000]


async def get_roll_items_for_export(db: AsyncSession, film_roll_id: int, user) -> tuple:
    """
    Busca a bobina e todos os ServiceOrderItems que a usaram, com dados completos da OS.

    Retorna (roll, items_with_orders) onde cada item tem service_order carregado
    com store, consultant, workers (employee), items (service) e created_by.
    """
    from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, ServiceOrderWorker

    roll_result = await db.execute(
        select(FilmRoll)
        .options(selectinload(FilmRoll.film_type), selectinload(FilmRoll.store))
        .where(FilmRoll.id == film_roll_id)
    )
    roll = roll_result.scalar_one_or_none()
    if not roll:
        raise NotFoundError(resource="Bobina")
    require_resource_access(user, roll.store_id, "Bobina")

    items_result = await db.execute(
        select(ServiceOrderItem)
        .options(
            selectinload(ServiceOrderItem.service),
            selectinload(ServiceOrderItem.service_order).selectinload(ServiceOrder.store),
            selectinload(ServiceOrderItem.service_order).selectinload(ServiceOrder.consultant),
            selectinload(ServiceOrderItem.service_order).selectinload(ServiceOrder.created_by),
            selectinload(ServiceOrderItem.service_order)
            .selectinload(ServiceOrder.workers)
            .selectinload(ServiceOrderWorker.employee),
        )
        .where(ServiceOrderItem.film_roll_id == film_roll_id)
        .order_by(ServiceOrderItem.id)
        .limit(50001)
    )
    items = list(items_result.scalars().all())
    if len(items) > 50000:
        raise ValidationError(
            detail="Export limitado a 50.000 itens. Bobina possui muitos registros."
        )
    return roll, items[:50000]


async def list_roll_service_orders(db: AsyncSession, film_roll_id: int, user):
    """Carros (O.S.) atendidos por uma bobina — drill-down do Rendimento.

    Reusa get_roll_items_for_export (roll + itens com O.S./workers/serviço) e
    junta os metros consumidos (FilmConsumption kind='consumo') por item.
    Respeita o escopo de loja (via get_roll_items_for_export).
    """
    from app.modules.inventory.schemas import RollServiceOrderRow, RollServiceOrdersResponse

    roll, items = await get_roll_items_for_export(db, film_roll_id, user)

    # Metros consumidos por item (kind=consumo; ignora estorno/ajuste/reconciliação).
    meters_by_item: dict[int, float] = {}
    consumptions = (
        (
            await db.execute(
                select(FilmConsumption).where(
                    FilmConsumption.film_roll_id == film_roll_id,
                    or_(FilmConsumption.kind == "consumo", FilmConsumption.kind.is_(None)),
                    FilmConsumption.service_order_item_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for c in consumptions:
        if c.service_order_item_id is not None:
            meters_by_item[c.service_order_item_id] = meters_by_item.get(
                c.service_order_item_id, 0.0
            ) + float(c.meters_consumed or 0)

    rows: list[RollServiceOrderRow] = []
    for item in items:
        so = item.service_order
        if so is None:
            continue
        installers = sorted({w.employee.name for w in so.workers if w.employee})
        rows.append(
            RollServiceOrderRow(
                service_order_id=so.id,
                vehicle_plate=so.vehicle_plate,
                service_date=so.service_date,
                service_code=item.service.code if item.service else None,
                service_name=item.service.name if item.service else None,
                installers=installers,
                meters_consumed=meters_by_item.get(item.id),
            )
        )
    rows.sort(key=lambda r: r.service_date or date.min, reverse=True)

    return RollServiceOrdersResponse(
        film_roll_id=roll.id,
        film_type_name=roll.film_type.name if roll.film_type else None,
        tonality=roll.tonality,
        receipt_date=roll.receipt_date,
        rows=rows,
    )


# ---------------------------------------------------------------------------
# Film Withdrawals (saída avulsa)
# ---------------------------------------------------------------------------


def _withdrawal_load_options():
    # Avaliado por chamada (não no import do módulo): encadear selectinload
    # dispara configure_mappers antes de todos os models estarem registrados
    return (
        selectinload(FilmWithdrawal.film_roll).selectinload(FilmRoll.film_type),
        selectinload(FilmWithdrawal.store),
        selectinload(FilmWithdrawal.employee),
        selectinload(FilmWithdrawal.created_by),
        selectinload(FilmWithdrawal.reversed_by),
    )


def build_withdrawal_response_dict(w: FilmWithdrawal) -> dict:
    """Constrói dicionário para FilmWithdrawalResponse a partir de uma saída carregada."""
    roll = w.film_roll
    film_type_name = roll.film_type.name if roll and roll.film_type else ""
    return {
        "id": w.id,
        "film_roll_id": w.film_roll_id,
        "roll_visual_id": compute_visual_id(
            film_type_name, roll.tonality, roll.receipt_date, roll.total_meters
        )
        if roll
        else "",
        "roll_receipt_date": roll.receipt_date if roll else None,
        "roll_total_meters": roll.total_meters if roll else None,
        "film_type_name": film_type_name or None,
        "tonality": roll.tonality if roll else None,
        "store_id": w.store_id,
        "store_name": w.store.name if w.store else None,
        "employee_id": w.employee_id,
        "employee_name": w.employee.name if w.employee else None,
        "meters": w.meters,
        "reason": w.reason,
        "created_by_name": w.created_by.full_name if w.created_by else None,
        "created_at": w.created_at,
        "reversed_at": w.reversed_at,
        "reversed_by_name": w.reversed_by.full_name if w.reversed_by else None,
        "is_reversed": w.reversed_at is not None,
    }


async def _get_withdrawal(db: AsyncSession, withdrawal_id: int) -> FilmWithdrawal:
    """Busca saída avulsa com relacionamentos eager loaded."""
    result = await db.execute(
        select(FilmWithdrawal)
        .options(*_withdrawal_load_options())
        .where(FilmWithdrawal.id == withdrawal_id)
    )
    withdrawal = result.scalar_one_or_none()
    if not withdrawal:
        raise NotFoundError(resource="Saída de película")
    return withdrawal


async def create_withdrawal(db: AsyncSession, data: FilmWithdrawalCreate, user) -> FilmWithdrawal:
    """
    Registra uma saída avulsa de película: metros entregues a um funcionário
    fora de O.S. (descontados em folha no fim do mês).

    Regras:
    - Bobina não pode estar esgotada nem lacrada (em_estoque) — precisa estar aberta
      (em_uso). A guarda vem de consume_roll adiante.
    - Metros não podem exceder o restante da bobina (permite zerar exatamente;
      zerar NÃO marca esgotada — esgotamento é manual, como no consumo por O.S.).
    - Funcionário deve existir e estar ativo (sem restrição à loja da bobina —
      volantes e galpão retiram de qualquer estoque acessível ao usuário).
    - Débito via consume_roll: ledger FilmConsumption e alerta de threshold já inclusos.
    """
    from app.modules.employees.models import Employee

    # Lock da bobina antes das validações — o consume_roll adiante re-busca
    # na mesma transação (lock já detido, sem deadlock)
    roll = await _get_roll_with_type(db, data.film_roll_id, for_update=True)

    require_resource_access(user, roll.store_id, "Bobina")

    if roll.status == "esgotada":
        raise ValidationError(detail="Esta bobina está esgotada e não pode ter saída de metros")

    if data.meters > roll.remaining_meters + 1e-6:
        raise ValidationError(
            detail=(
                f"A bobina possui apenas {roll.remaining_meters:.2f} m restantes — "
                f"não é possível retirar {data.meters:.2f} m."
            )
        )

    employee_result = await db.execute(
        select(Employee).where(
            Employee.id == data.employee_id,
            Employee.is_active == True,  # noqa: E712
        )
    )
    employee = employee_result.scalar_one_or_none()
    if not employee:
        raise ValidationError(detail="Funcionário não encontrado ou inativo")

    withdrawal = FilmWithdrawal(
        film_roll_id=roll.id,
        store_id=roll.store_id,
        employee_id=employee.id,
        meters=data.meters,
        reason=data.reason,
        created_by_user_id=getattr(user, "id", None),
        created_at=datetime.now(UTC),
    )
    db.add(withdrawal)
    await db.flush()

    await consume_roll(
        db,
        roll.id,
        service_order_item_id=None,
        meters=data.meters,
        film_withdrawal_id=withdrawal.id,
    )

    await log_audit(
        db=db,
        action="create",
        resource_type="film_withdrawal",
        user_id=getattr(user, "id", None),
        resource_id=withdrawal.id,
        new_value={
            "film_roll_id": roll.id,
            "store_id": roll.store_id,
            "employee_id": employee.id,
            "meters": data.meters,
        },
    )

    await db.commit()
    return await _get_withdrawal(db, withdrawal.id)


async def reverse_withdrawal(db: AsyncSession, withdrawal_id: int, user) -> FilmWithdrawal:
    """
    Estorna uma saída avulsa: devolve os metros à bobina (ledger negativo) e
    marca a saída como estornada (soft — permanece na listagem, sai do resumo).

    Não altera o status da bobina: uma bobina marcada como esgotada permanece
    esgotada (restauração é manual via restore_roll).
    """
    withdrawal = await _get_withdrawal(db, withdrawal_id)

    require_resource_access(user, withdrawal.store_id, "Saída de película")

    if withdrawal.reversed_at is not None:
        raise ValidationError(detail="Esta saída já foi estornada")

    await release_roll_meters(
        db,
        withdrawal.film_roll_id,
        service_order_item_id=None,
        meters=withdrawal.meters,
        film_withdrawal_id=withdrawal.id,
    )

    withdrawal.reversed_at = datetime.now(UTC)
    withdrawal.reversed_by_user_id = getattr(user, "id", None)
    await db.flush()

    await log_audit(
        db=db,
        action="reverse",
        resource_type="film_withdrawal",
        user_id=getattr(user, "id", None),
        resource_id=withdrawal.id,
        old_value={"reversed_at": None},
        new_value={"meters_returned": withdrawal.meters},
    )

    await db.commit()
    return await _get_withdrawal(db, withdrawal.id)


async def _apply_withdrawal_filters(
    db: AsyncSession,
    query,
    user,
    store_id: int | None = None,
    employee_id: int | None = None,
    film_type_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """
    Aplica filtros de permissão (loja + galpão) e de atributo às queries de
    saída avulsa. Espelha a lógica de galpão de list_rolls sobre o store_id
    snapshot da saída.
    """
    from app.modules.stores.models import Store

    if is_galpon_profile_user(user):
        galpon_result = await db.execute(
            select(Store.id).where(Store.is_galpon_store == True).limit(1)  # noqa: E712
        )
        galpon_store_id = galpon_result.scalar_one_or_none()
        if galpon_store_id is None:
            raise NotFoundError(resource="Loja Galpão")
        query = query.where(FilmWithdrawal.store_id == galpon_store_id)
    else:
        query = apply_store_filter(query, user, FilmWithdrawal.store_id)

        if hide_galpon_user(user):
            galpon_result = await db.execute(
                select(Store.id).where(Store.is_galpon_store == True).limit(1)  # noqa: E712
            )
            galpon_store_id = galpon_result.scalar_one_or_none()
            if galpon_store_id is not None:
                query = query.where(FilmWithdrawal.store_id != galpon_store_id)

        if store_id is not None:
            query = query.where(FilmWithdrawal.store_id == store_id)

    if employee_id is not None:
        query = query.where(FilmWithdrawal.employee_id == employee_id)

    if film_type_id is not None:
        query = query.where(
            FilmWithdrawal.film_roll_id.in_(
                select(FilmRoll.id).where(FilmRoll.film_type_id == film_type_id)
            )
        )

    # Período no fuso local: [date_from 00:00, date_to+1dia 00:00)
    if date_from is not None:
        query = query.where(
            FilmWithdrawal.created_at >= datetime.combine(date_from, time.min, tzinfo=TZ_LOCAL)
        )
    if date_to is not None:
        query = query.where(
            FilmWithdrawal.created_at
            < datetime.combine(date_to, time.min, tzinfo=TZ_LOCAL) + timedelta(days=1)
        )

    return query


async def list_withdrawals(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    employee_id: int | None = None,
    film_type_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[FilmWithdrawal], int]:
    """Lista saídas avulsas com filtros e paginação (inclui estornadas)."""
    query = select(FilmWithdrawal).options(*_withdrawal_load_options())
    query = await _apply_withdrawal_filters(
        db, query, user, store_id, employee_id, film_type_id, date_from, date_to
    )
    return await paginate(db, query, page, limit, order_by=FilmWithdrawal.created_at.desc())


async def list_withdrawals_for_export(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    employee_id: int | None = None,
    film_type_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[FilmWithdrawal]:
    """Lista saídas avulsas sem paginação para geração de Excel."""
    query = select(FilmWithdrawal).options(*_withdrawal_load_options())
    query = await _apply_withdrawal_filters(
        db, query, user, store_id, employee_id, film_type_id, date_from, date_to
    )
    query = query.order_by(FilmWithdrawal.created_at.desc()).limit(50001)
    result = await db.execute(query)
    withdrawals = list(result.scalars().all())
    if len(withdrawals) > 50000:
        raise ValidationError(
            detail="Export limitado a 50.000 registros. Aplique filtros para reduzir o volume."
        )
    return withdrawals


async def summarize_withdrawals(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    employee_id: int | None = None,
    film_type_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    """
    Total de saídas por funcionário no período (para desconto em folha).
    Exclui saídas estornadas.
    """
    from app.modules.employees.models import Employee

    query = (
        select(
            FilmWithdrawal.employee_id,
            Employee.name.label("employee_name"),
            func.count(FilmWithdrawal.id).label("withdrawal_count"),
            func.sum(FilmWithdrawal.meters).label("total_meters"),
        )
        .join(Employee, Employee.id == FilmWithdrawal.employee_id)
        .where(FilmWithdrawal.reversed_at.is_(None))
        .group_by(FilmWithdrawal.employee_id, Employee.name)
        .order_by(func.sum(FilmWithdrawal.meters).desc())
    )
    query = await _apply_withdrawal_filters(
        db, query, user, store_id, employee_id, film_type_id, date_from, date_to
    )
    result = await db.execute(query)
    return [
        {
            "employee_id": row.employee_id,
            "employee_name": row.employee_name,
            "withdrawal_count": row.withdrawal_count,
            "total_meters": float(row.total_meters or 0),
        }
        for row in result.all()
    ]
