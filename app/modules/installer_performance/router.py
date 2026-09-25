"""
Router do Desempenho de Instaladores.

Permissão via perfil de acesso (submódulo "installer_performance"):
- can_view para ler os relatórios e gerar os PDFs. Owner tem acesso total.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission
from app.db.session import get_db
from app.modules.installer_performance import pdf, service
from app.modules.installer_performance.schemas import (
    DailyReportResponse,
    IndividualReportResponse,
    ReturnsReportResponse,
    SummaryReportResponse,
)

router = APIRouter(prefix="/installer-performance", tags=["Installer Performance"])

SUB_MODULE = "installer_performance"


@router.get("/daily", response_model=DailyReportResponse)
async def get_daily(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    report_date: date = Query(..., alias="date", description="Dia do relatório (YYYY-MM-DD)"),
    store_id: int | None = Query(None, description="Filtra por loja (seletor global)"),
    search: str | None = Query(None, description="Busca por nome do instalador"),
    employee_ids: list[int] | None = Query(None, description="Filtra por instaladores (checkbox)"),
):
    """Relatório diário agrupado por instalador (O.S. finalizadas no dia)."""
    return await service.get_daily_report(
        db=db,
        user=current_user,
        report_date=report_date,
        store_id=store_id,
        search=search,
        employee_ids=employee_ids,
    )


@router.get("/individual", response_model=IndividualReportResponse)
async def get_individual(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    start: date = Query(..., description="Início do período (YYYY-MM-DD)"),
    end: date = Query(..., description="Fim do período (YYYY-MM-DD)"),
    employee_id: int = Query(..., description="Instalador (obrigatório)"),
    store_id: int | None = Query(None, description="Filtra por loja (seletor global)"),
):
    """Relatório individual detalhado de um instalador no período."""
    return await service.get_individual_report(
        db=db, user=current_user, start=start, end=end, employee_id=employee_id, store_id=store_id
    )


@router.get("/export/daily")
async def export_daily(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    report_date: date = Query(..., alias="date", description="Dia do relatório (YYYY-MM-DD)"),
    store_id: int | None = Query(None, description="Filtra por loja (seletor global)"),
    search: str | None = Query(None, description="Busca por nome do instalador"),
    employee_ids: list[int] | None = Query(None, description="Filtra por instaladores (checkbox)"),
):
    """Gera o PDF do relatório diário (respeita os filtros aplicados)."""
    data = await service.get_daily_report(
        db=db,
        user=current_user,
        report_date=report_date,
        store_id=store_id,
        search=search,
        employee_ids=employee_ids,
    )
    content = pdf.generate_daily_pdf(data)
    filename = f"desempenho_instaladores_{report_date.strftime('%Y%m%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/summary", response_model=SummaryReportResponse)
async def get_summary(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    start: date = Query(..., description="Início do período (YYYY-MM-DD)"),
    end: date = Query(..., description="Fim do período (YYYY-MM-DD)"),
    store_id: int | None = Query(None, description="Filtra por loja"),
):
    """Resumo de todos os instaladores no período."""
    return await service.get_summary_report(
        db=db, user=current_user, start=start, end=end, store_id=store_id
    )


@router.get("/export/summary")
async def export_summary(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    start: date = Query(...),
    end: date = Query(...),
    store_id: int | None = Query(None),
):
    """Gera o PDF do Resumo de Instaladores."""
    data = await service.get_summary_report(
        db=db, user=current_user, start=start, end=end, store_id=store_id
    )
    content = pdf.generate_summary_pdf(data)
    filename = f"resumo_instaladores_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/returns", response_model=ReturnsReportResponse)
async def get_returns(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    start: date = Query(..., description="Início do período (YYYY-MM-DD)"),
    end: date = Query(..., description="Fim do período (YYYY-MM-DD)"),
    store_id: int | None = Query(None, description="Filtra por loja (seletor global)"),
):
    """Tabela de retornos no período (retorno × serviço anterior)."""
    return await service.get_returns_report(
        db=db, user=current_user, start=start, end=end, store_id=store_id
    )


@router.get("/export/returns")
async def export_returns(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    start: date = Query(...),
    end: date = Query(...),
    store_id: int | None = Query(None),
):
    """Gera o PDF da aba Retornos (retorno × serviço anterior)."""
    data = await service.get_returns_report(
        db=db, user=current_user, start=start, end=end, store_id=store_id
    )
    content = pdf.generate_returns_pdf(data)
    filename = f"retornos_instaladores_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/individual")
async def export_individual(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    start: date = Query(..., description="Início do período (YYYY-MM-DD)"),
    end: date = Query(..., description="Fim do período (YYYY-MM-DD)"),
    employee_id: int = Query(..., description="Instalador (obrigatório)"),
    store_id: int | None = Query(None, description="Filtra por loja (seletor global)"),
):
    """Gera o PDF do relatório individual do instalador (respeita os filtros)."""
    data = await service.get_individual_report(
        db=db, user=current_user, start=start, end=end, employee_id=employee_id, store_id=store_id
    )
    content = pdf.generate_individual_pdf(data)
    filename = f"desempenho_instalador_{employee_id}_{start.strftime('%Y%m%d')}_{end.strftime('%Y%m%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
