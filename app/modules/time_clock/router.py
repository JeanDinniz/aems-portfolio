"""
Time Clock router - API endpoints do ponto eletrônico.

Permissões (Perfil de Acesso):
- time_clock (Ponto — Bater): página do funcionário, punch e /me
  (além da permissão, o punch exige vínculo Employee.user_id).
- time_clock_mirror (Ponto — Espelho): espelho admin e export.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import NotFoundError
from app.core.permissions import check_profile_permission
from app.core.rate_limit import limiter
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.time_clock import service
from app.modules.time_clock.schemas import (
    EnrollFaceRequest,
    EnrollFaceResponse,
    PunchRequest,
    TimeClockAdjustmentCreate,
    TimeClockAnnulRequest,
    TimeClockListResponse,
    TimeClockMeMirrorResponse,
    TimeClockMeResponse,
    TimeClockRecordResponse,
)


def _require_time_clock_enabled() -> None:
    """Feature flag TIME_CLOCK_ENABLED: módulo desligado responde 404 (ex.: produção)."""
    if not get_settings().TIME_CLOCK_ENABLED:
        raise NotFoundError()


router = APIRouter(
    prefix="/time-clock",
    tags=["Time Clock"],
    dependencies=[Depends(_require_time_clock_enabled)],
)


@router.post(
    "/punch",
    response_model=TimeClockRecordResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("time_clock", "can_view"))],
)
@limiter.limit("10/minute")
async def punch(
    request: Request,
    data: PunchRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Registra uma batida de ponto (entrada/saída) com selfie e localização.
    Horário é o do servidor; geofence sinaliza mas nunca bloqueia.
    """
    record = await service.punch(db, current_user.id, data)
    return service.record_to_response(record)


@router.get(
    "/records/{record_id}/receipt",
    dependencies=[Depends(check_profile_permission("time_clock", "can_view"))],
)
async def get_receipt(
    record_id: int,
    format: str = Query("json", pattern="^(json|pdf)$"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Comprovante de registro de uma batida (JSON ou PDF cupom), com o NSR real.
    O funcionário pode salvar/compartilhar como prova de marcação (Portaria 671).

    Escopo: SÓ o dono da batida (o próprio funcionário). Contém dado pessoal
    (CPF/nome); o RH consulta pela via do espelho/AFD. Batida inexistente OU de
    outro funcionário respondem 404 (não vaza existência nem permite enumeração).
    """
    from app.modules.time_clock import export
    from app.modules.time_clock.models import TimeClockRecord

    employee = await service.get_employee_for_user(db, current_user.id)
    record = await db.get(TimeClockRecord, record_id)
    if record is None or employee is None or record.employee_id != employee.id:
        raise NotFoundError(resource="Batida")
    await db.refresh(record, ["employee"])
    receipt = service.build_receipt(record, get_settings())
    if format == "pdf":
        content = export.generate_receipt_pdf(receipt)
        return Response(content=content, media_type="application/pdf")
    return receipt


@router.post(
    "/enroll-face",
    response_model=EnrollFaceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("time_clock", "can_view"))],
)
@limiter.limit("10/minute")
async def enroll_face(
    request: Request,
    data: EnrollFaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cadastra o rosto de referência (embedding gerado no aparelho) do funcionário
    vinculado ao usuário logado. Exige consentimento LGPD. Não armazena a imagem.
    """
    return await service.enroll_face(db, current_user.id, data.embedding, data.consent)


@router.get(
    "/me",
    response_model=TimeClockMeResponse,
    dependencies=[Depends(check_profile_permission("time_clock", "can_view"))],
)
async def me(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Estado do ponto do usuário logado (employee_id null = sem vínculo)."""
    return await service.get_me(db, current_user.id)


@router.get(
    "/me/mirror",
    response_model=TimeClockMeMirrorResponse,
    dependencies=[Depends(check_profile_permission("time_clock", "can_view"))],
)
async def me_mirror(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    period: str = Query("month", pattern="^(24h|month)$", description="'24h' ou 'month'"),
):
    """
    Autoatendimento (Portaria 671): o próprio funcionário consulta seu espelho das
    últimas 24h ou do mês corrente, sem depender do RH.
    """
    from app.core.exceptions import ValidationError

    result = await service.get_my_mirror(db, current_user.id, period)
    if result is None:
        raise ValidationError(detail="Seu usuário não está vinculado a um funcionário.")
    return result


@router.get(
    "/me/export/pdf",
    dependencies=[Depends(check_profile_permission("time_clock", "can_view"))],
)
async def me_export_pdf(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    period: str = Query("month", pattern="^(24h|month)$", description="'24h' ou 'month'"),
):
    """Exporta em PDF o espelho do próprio funcionário (autoatendimento)."""
    from app.core.exceptions import ValidationError
    from app.modules.time_clock import export

    result = await service.get_my_mirror(db, current_user.id, period)
    if result is None:
        raise ValidationError(detail="Seu usuário não está vinculado a um funcionário.")

    label = "Últimas 24h" if period == "24h" else "Mês corrente"
    content = await export.generate_employee_mirror_pdf(
        db,
        employee_id=result["employee_id"],
        start=result["start"],
        end=result["end"],
        employee_name=result["employee_name"] or "",
        period_label=label,
    )
    filename = f"meu_espelho_ponto_{period}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "",
    response_model=TimeClockListResponse,
    dependencies=[Depends(check_profile_permission("time_clock_mirror", "can_view"))],
)
async def list_records(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="Filtrar por loja"),
    day: date | None = Query(None, alias="date", description="Dia (default: hoje)"),
    employee_id: int | None = Query(None, description="Filtrar por funcionário"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    """Espelho de ponto: registros por loja/dia com selfie e geolocalização."""
    effective_day = day or service.local_today()
    records, total = await service.list_records(
        db,
        current_user,
        store_id=store_id,
        day=effective_day,
        employee_id=employee_id,
        page=page,
        limit=limit,
    )
    return PaginatedResponse.create(
        items=[service.record_to_response(r) for r in records],
        total=total,
        page=page,
        limit=limit,
    )


@router.post(
    "/adjustments",
    response_model=TimeClockRecordResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("time_clock_mirror", "can_edit"))],
)
async def create_adjustment(
    request: Request,
    data: TimeClockAdjustmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Correção administrativa (RH): lança uma batida esquecida como NOVO registro
    vinculado — nunca sobrescreve a marcação bruta. Motivo obrigatório; a ação
    fica na trilha de auditoria (quem, quando, motivo, IP).
    """
    record = await service.create_adjustment(db, current_user, data, request)
    return service.record_to_response(record)


@router.post(
    "/{record_id}/annul",
    response_model=TimeClockRecordResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("time_clock_mirror", "can_edit"))],
)
async def annul_record(
    request: Request,
    record_id: int,
    data: TimeClockAnnulRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Anula uma batida existente criando um registro de anulação vinculado
    (o bruto original permanece imutável). Motivo obrigatório; grava auditoria.
    """
    record = await service.annul_record(db, current_user, record_id, data.reason, request)
    return service.record_to_response(record)


@router.get(
    "/export/pdf",
    dependencies=[Depends(check_profile_permission("time_clock_mirror", "can_view"))],
)
async def export_pdf(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int = Query(..., description="ID da loja (obrigatório)"),
    day: date = Query(..., alias="date", description="Dia do espelho"),
):
    """Espelho de ponto do dia em PDF (sem as selfies — visíveis no sistema)."""
    from app.core.permissions import require_resource_access
    from app.modules.time_clock import export

    require_resource_access(current_user, store_id, "Espelho de Ponto")

    content = await export.generate_mirror_pdf(
        db, store_id=store_id, day=day, generated_by=current_user.full_name
    )
    filename = f"espelho_ponto_{store_id}_{day.strftime('%Y%m%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/export/afd",
    dependencies=[Depends(check_profile_permission("time_clock_mirror", "can_view"))],
)
async def export_afd(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int = Query(..., description="ID da loja (obrigatório)"),
    start: date = Query(..., description="Data inicial (YYYY-MM-DD)"),
    end: date = Query(..., description="Data final (YYYY-MM-DD)"),
):
    """
    AFD (Arquivo Fonte de Dados) do período, compatível com o leiaute da Portaria
    671 — SEM assinatura ICP-Brasil (controle interno). Grava a geração na auditoria.
    """
    from app.core.audit import log_audit
    from app.core.permissions import require_resource_access
    from app.modules.time_clock import afd_aej

    require_resource_access(current_user, store_id, "AFD do Ponto")
    content = await afd_aej.generate_afd(db, store_id=store_id, start=start, end=end)
    await log_audit(
        db,
        action="time_clock_afd_exported",
        resource_type="time_clock_export",
        user_id=current_user.id,
        resource_id=store_id,
        new_value={"store_id": store_id, "start": str(start), "end": str(end)},
        request=request,
    )
    filename = f"AFD_{store_id}_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}.txt"
    return Response(
        content=content.encode("latin-1", "replace"),
        media_type="text/plain; charset=latin-1",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/export/aej",
    dependencies=[Depends(check_profile_permission("time_clock_mirror", "can_view"))],
)
async def export_aej(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int = Query(..., description="ID da loja (obrigatório)"),
    start: date = Query(..., description="Data inicial (YYYY-MM-DD)"),
    end: date = Query(..., description="Data final (YYYY-MM-DD)"),
):
    """
    AEJ (Arquivo Eletrônico de Jornada) do período — versão SIMPLIFICADA e SEM
    assinatura (ver afd_aej.py). Grava a geração na auditoria.
    """
    from app.core.audit import log_audit
    from app.core.permissions import require_resource_access
    from app.modules.time_clock import afd_aej

    require_resource_access(current_user, store_id, "AEJ do Ponto")
    content = await afd_aej.generate_aej(db, store_id=store_id, start=start, end=end)
    await log_audit(
        db,
        action="time_clock_aej_exported",
        resource_type="time_clock_export",
        user_id=current_user.id,
        resource_id=store_id,
        new_value={"store_id": store_id, "start": str(start), "end": str(end)},
        request=request,
    )
    filename = f"AEJ_{store_id}_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}.txt"
    return Response(
        content=content.encode("latin-1", "replace"),
        media_type="text/plain; charset=latin-1",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
