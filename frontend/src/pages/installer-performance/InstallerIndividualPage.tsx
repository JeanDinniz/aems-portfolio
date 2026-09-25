import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileDown, DollarSign, Car, AlertCircle, ChevronDown, Star } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useInstallerIndividual } from '@/hooks/useInstallerPerformance';
import installerPerformanceService from '@/services/api/installerPerformance.service';
import { employeesService } from '@/services/api/employees.service';
import { FILM_INSTALLER_POSITION } from '@/constants/employees';
import { KpiCard } from '@/components/features/dashboard/KpiCard';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Employee } from '@/types/employee.types';
import type { IndividualFilters } from '@/types/installerPerformance.types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayLocal(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function firstDayOfMonthLocal(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}-01`;
}

function formatDateBR(isoDate: string): string {
    const [year, month, day] = isoDate.substring(0, 10).split('-');
    return `${day}/${month}/${year}`;
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Tab nav ─────────────────────────────────────────────────────────────────

function TabNav() {
    const location = useLocation();
    const tabs = [
        { to: '/desempenho-instaladores', label: 'Diario' },
        { to: '/desempenho-instaladores/individual', label: 'Individual' },
        { to: '/desempenho-instaladores/resumo', label: 'Resumo' },
        { to: '/desempenho-instaladores/retornos', label: 'Retornos' },
    ];
    return (
        <div className="flex gap-1 border-b border-gray-200 dark:border-[#1E1E1E] mb-6">
            {tabs.map((tab) => {
                const isActive = location.pathname === tab.to;
                return (
                    <Link
                        key={tab.to}
                        to={tab.to}
                        className={cn(
                            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                            isActive
                                ? 'border-[#F5A800] text-[#F5A800]'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                        )}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </div>
    );
}

// ─── Employee Combobox ────────────────────────────────────────────────────────

interface EmployeeComboboxProps {
    value: number | null;
    onChange: (id: number | null) => void;
    employees: Employee[];
    isLoading: boolean;
}

function EmployeeCombobox({ value, onChange, employees, isLoading }: EmployeeComboboxProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            setSearch('');
        }
    }, [open]);

    const term = search.trim().toLowerCase();
    const filtered = term
        ? employees.filter((e) => e.name.toLowerCase().includes(term))
        : employees;

    const selected = employees.find((e) => e.id === value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    disabled={isLoading}
                    className={cn(
                        'w-full sm:w-72 h-10 justify-between font-normal text-left overflow-hidden',
                        !selected && 'text-muted-foreground'
                    )}
                    aria-label="Selecionar instalador"
                >
                    <span className="truncate min-w-0">
                        {isLoading ? 'Carregando...' : (selected?.name ?? 'Selecione um instalador')}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="p-0 w-[calc(100vw-2rem)] sm:w-[320px]"
                align="start"
                side="bottom"
                avoidCollisions
            >
                <div className="p-2 border-b">
                    <Input
                        ref={inputRef}
                        placeholder="Buscar por nome..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 text-sm"
                    />
                </div>
                <div className="overflow-y-auto max-h-[300px]">
                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                            Nenhum instalador encontrado.
                        </div>
                    ) : (
                        filtered.map((emp) => (
                            <button
                                key={emp.id}
                                type="button"
                                className={cn(
                                    'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors',
                                    emp.id === value && 'bg-accent font-medium'
                                )}
                                onClick={() => { onChange(emp.id); setOpen(false); }}
                            >
                                <span className="block leading-tight">{emp.name}</span>
                                {emp.store_name && (
                                    <span className="block text-xs text-muted-foreground leading-tight">
                                        {emp.store_name}
                                    </span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InstallerIndividualPage() {
    // O relatório individual é pessoal (o instalador pode atuar em várias lojas),
    // por isso NÃO é limitado pelo seletor global de loja.
    const [start, setStart] = useState<string>(firstDayOfMonthLocal);
    const [end, setEnd] = useState<string>(todayLocal);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    // Carrega SÓ instaladores (cargo "Instalador de Película"), todas as lojas.
    const { data: employees = [], isLoading: isLoadingEmployees } = useQuery({
        queryKey: ['employees', 'installers-all-stores'],
        queryFn: () =>
            employeesService
                .list({ position: FILM_INSTALLER_POSITION, is_active: true }, 1, 500)
                .then((r) => r.employees),
        staleTime: 1000 * 60 * 10,
    });

    const filters: IndividualFilters | null =
        selectedEmployeeId !== null
            ? {
                  start,
                  end,
                  employee_id: selectedEmployeeId,
              }
            : null;

    const { data, isLoading, isError, refetch } = useInstallerIndividual(filters);

    const handleExport = async () => {
        if (!filters) return;
        setIsExporting(true);
        try {
            const blob = await installerPerformanceService.exportIndividual(filters);
            downloadBlob(
                blob,
                `desempenho_instalador_${filters.employee_id}_${filters.start}_${filters.end}.pdf`
            );
        } catch {
            // error is surfaced via QueryCache globally
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                        Desempenho de Instaladores
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        Relatorio individual por periodo
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={isExporting || isLoading || !selectedEmployeeId}
                    className="flex items-center gap-2 self-start sm:self-auto"
                    aria-label="Gerar PDF do instalador"
                >
                    <FileDown className="h-4 w-4" />
                    {isExporting ? 'Gerando PDF...' : 'Gerar PDF do Instalador'}
                </Button>
            </div>

            {/* Tab navigation */}
            <TabNav />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                    <label htmlFor="ind-start" className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Inicio
                    </label>
                    <Input
                        id="ind-start"
                        type="date"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className="w-44"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="ind-end" className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Fim
                    </label>
                    <Input
                        id="ind-end"
                        type="date"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        className="w-44"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                    <label
                        id="employee-combobox-label"
                        className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                    >
                        Instalador <span className="text-red-500">*</span>
                    </label>
                    <EmployeeCombobox
                        value={selectedEmployeeId}
                        onChange={setSelectedEmployeeId}
                        employees={employees}
                        isLoading={isLoadingEmployees}
                    />
                </div>
            </div>

            {/* No employee selected */}
            {!selectedEmployeeId ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <Car className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                    <p className="text-base font-medium text-gray-500 dark:text-gray-400">
                        Selecione um instalador
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                        Use o seletor acima para escolher o instalador desejado.
                    </p>
                </div>
            ) : isLoading ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Skeleton className="h-24 rounded-lg" />
                        <Skeleton className="h-24 rounded-lg" />
                    </div>
                    <Skeleton className="h-64 rounded-lg" />
                </>
            ) : isError ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <AlertCircle className="h-8 w-8 text-red-500" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Nao foi possivel carregar o relatorio.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => void refetch()}>
                        Tentar novamente
                    </Button>
                </div>
            ) : !data ? null : (
                <>
                    {/* KPI cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <KpiCard
                            label="Total de Carros no Periodo"
                            value={String(data.total_cars)}
                            icon={Car}
                            delta={null}
                            badgeText={`${Number.isInteger(data.total_services) ? data.total_services : data.total_services.toFixed(2).replace(/0$/, '').replace('.', ',')} ${data.total_services === 1 ? 'servico' : 'servicos'}`}
                        />
                        <KpiCard
                            label="Faturamento Total no Periodo"
                            value={formatCurrency(data.total_revenue)}
                            icon={DollarSign}
                            delta={null}
                        />
                        <KpiCard
                            label="Pontos no periodo"
                            value={data.total_points.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            icon={Star}
                            delta={null}
                        />
                    </div>

                    {/* Results summary */}
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        <span className="font-medium text-gray-900 dark:text-white">{data.employee_name}</span>
                        {' '}·{' '}
                        {formatDateBR(data.period_start)} a {formatDateBR(data.period_end)}
                        {data.store_name && (
                            <span className="ml-2 text-xs text-gray-400">· {data.store_name}</span>
                        )}
                    </div>

                    {/* Rows table */}
                    {data.rows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                            <Car className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                            <p className="text-base font-medium text-gray-500 dark:text-gray-400">
                                Nenhum servico no periodo
                            </p>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-[#1E1E1E] rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-left text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-[#1E1E1E]">
                                            <th className="px-4 py-2.5 font-medium">Data</th>
                                            <th className="px-4 py-2.5 font-medium">O.S.</th>
                                            <th className="px-4 py-2.5 font-medium">Placa</th>
                                            <th className="px-4 py-2.5 font-medium">Veiculo</th>
                                            <th className="px-4 py-2.5 font-medium">Loja</th>
                                            <th className="px-4 py-2.5 font-medium">Servicos</th>
                                            <th className="px-4 py-2.5 font-medium">Tipo</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Pontos</th>
                                            <th className="px-4 py-2.5 font-medium text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-[#1E1E1E]">
                                        {data.rows.map((row, idx) => {
                                            const osLabel = row.external_os_number ?? row.order_number ?? `#${row.os_id}`;
                                            return (
                                                <tr
                                                    key={`${row.os_id}-${idx}`}
                                                    className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                                                >
                                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                        {formatDateBR(row.completion_date)}
                                                    </td>
                                                    <td className="px-4 py-2 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                        {osLabel}
                                                    </td>
                                                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                                        {row.plate}
                                                    </td>
                                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                        {row.vehicle ?? '—'}
                                                    </td>
                                                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                        {row.store_name ?? '—'}
                                                    </td>
                                                    <td
                                                        className="px-4 py-2 text-gray-600 dark:text-gray-400 max-w-[220px] truncate"
                                                        title={row.services.join(' + ')}
                                                    >
                                                        {row.services.join(' + ') || '—'}
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap">
                                                        {row.is_return || row.is_courtesy || row.has_shared ? (
                                                            <span className="inline-flex flex-wrap gap-1">
                                                                {row.is_return && (
                                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 uppercase tracking-wide">
                                                                        Retorno
                                                                    </span>
                                                                )}
                                                                {row.is_courtesy && (
                                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                                                                        Cortesia
                                                                    </span>
                                                                )}
                                                                {row.has_shared && (
                                                                    <span
                                                                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 uppercase tracking-wide"
                                                                        title="Serviço feito por mais de um instalador — produção dividida igualmente"
                                                                    >
                                                                        Dividido
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-400 dark:text-gray-600">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2 text-right whitespace-nowrap">
                                                        <span className="font-medium text-gray-900 dark:text-white">
                                                            {row.points.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right whitespace-nowrap">
                                                        <span className="font-medium text-gray-900 dark:text-white">
                                                            {formatCurrency(row.value)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
