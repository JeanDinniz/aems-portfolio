import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileDown, Car, AlertCircle, Gauge, ChevronDown, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useInstallerDaily } from '@/hooks/useInstallerPerformance';
import installerPerformanceService from '@/services/api/installerPerformance.service';
import { employeesService } from '@/services/api/employees.service';
import { FILM_INSTALLER_POSITION } from '@/constants/employees';
import { useStoreStore } from '@/stores/store.store';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Employee } from '@/types/employee.types';
import type { DailyInstallerGroup } from '@/types/installerPerformance.types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayLocal(): string {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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

// ─── Installer multi-select ───────────────────────────────────────────────────

interface InstallerMultiSelectProps {
    employees: Employee[];
    isLoading: boolean;
    value: number[];
    onChange: (ids: number[]) => void;
}

function InstallerMultiSelect({ employees, isLoading, value, onChange }: InstallerMultiSelectProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            // Small delay so Popover finishes mounting before focusing
            const t = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(t);
        }
        // Reset search after popover closes (next microtask to avoid
        // synchronous setState inside an effect body).
        const t = setTimeout(() => setSearch(''), 0);
        return () => clearTimeout(t);
    }, [open]);

    const term = search.trim().toLowerCase();
    const filtered = term
        ? employees.filter((e) => e.name.toLowerCase().includes(term))
        : employees;

    const toggle = (id: number) =>
        onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

    const clear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange([]);
    };

    // Label for the trigger button
    let triggerLabel: string;
    if (isLoading) {
        triggerLabel = 'Carregando...';
    } else if (value.length === 0) {
        triggerLabel = 'Todos os instaladores';
    } else if (value.length === 1) {
        const found = employees.find((e) => e.id === value[0]);
        triggerLabel = found?.name ?? '1 selecionado';
    } else {
        triggerLabel = `${value.length} selecionado(s)`;
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={isLoading}
                    className={cn(
                        'flex h-10 w-full sm:w-72 items-center justify-between gap-2 rounded-lg',
                        'border border-[#D1D1D1] dark:border-[#333333]',
                        'bg-white dark:bg-[#252525]',
                        'px-3 text-sm text-[#111111] dark:text-white',
                        'cursor-pointer hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A]',
                        'focus:outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800]',
                        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        value.length > 0 && 'text-[#111111] dark:text-white'
                    )}
                    aria-label="Filtrar por instalador"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                >
                    <span className="truncate min-w-0 text-left">{triggerLabel}</span>
                    <span className="flex items-center gap-1 shrink-0">
                        {value.length > 0 && (
                            <span
                                role="button"
                                tabIndex={0}
                                aria-label="Limpar selecao de instaladores"
                                className="rounded hover:bg-[#E5E5E5] dark:hover:bg-[#3A3A3A] p-0.5 transition-colors"
                                onClick={clear}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') clear(e as unknown as React.MouseEvent); }}
                            >
                                <X className="h-3.5 w-3.5 opacity-60" />
                            </span>
                        )}
                        <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform duration-200', open && 'rotate-180')} />
                    </span>
                </button>
            </PopoverTrigger>

            <PopoverContent
                className="p-0 w-[calc(100vw-2rem)] sm:w-[320px] border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A]"
                align="start"
                side="bottom"
                avoidCollisions
            >
                {/* Search field */}
                <div className="p-2 border-b border-[#E5E5E5] dark:border-[#2A2A2A]">
                    <Input
                        ref={inputRef}
                        placeholder="Buscar por nome..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 text-sm"
                        aria-label="Buscar instalador por nome"
                    />
                </div>

                {/* Clear all option */}
                {value.length > 0 && (
                    <div className="px-2 pt-1.5 pb-0.5">
                        <button
                            type="button"
                            className="w-full text-left px-2 py-1 text-xs text-[#F5A800] hover:underline"
                            onClick={() => onChange([])}
                            aria-label="Limpar todos os instaladores selecionados"
                        >
                            Limpar ({value.length})
                        </button>
                    </div>
                )}

                {/* List */}
                <div
                    role="listbox"
                    aria-label="Lista de instaladores"
                    aria-multiselectable="true"
                    className="overflow-y-auto max-h-[280px] py-1"
                >
                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500 text-center">
                            Nenhum instalador encontrado.
                        </div>
                    ) : (
                        filtered.map((emp) => {
                            const checked = value.includes(emp.id);
                            const checkId = `installer-cb-${emp.id}`;
                            return (
                                <div
                                    key={emp.id}
                                    role="option"
                                    aria-selected={checked}
                                    className={cn(
                                        'flex items-start gap-2.5 w-full px-3 py-2 cursor-pointer',
                                        'hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors',
                                        checked && 'bg-[#FFF8E7] dark:bg-[#2A2010]'
                                    )}
                                    onClick={() => toggle(emp.id)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(emp.id); }}
                                    tabIndex={0}
                                >
                                    <Checkbox
                                        id={checkId}
                                        checked={checked}
                                        onCheckedChange={() => toggle(emp.id)}
                                        aria-label={`Selecionar instalador ${emp.name}`}
                                        className="mt-0.5 shrink-0 border-[#F5A800] data-[state=checked]:bg-[#F5A800] data-[state=checked]:border-[#F5A800]"
                                    />
                                    <label htmlFor={checkId} className="min-w-0 cursor-pointer select-none">
                                        <span className="block text-sm leading-tight text-[#111111] dark:text-white">
                                            {emp.name}
                                        </span>
                                        {emp.store_name && (
                                            <span className="block text-xs leading-tight text-gray-400 dark:text-gray-500">
                                                {emp.store_name}
                                            </span>
                                        )}
                                    </label>
                                </div>
                            );
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

// ─── Installer card ───────────────────────────────────────────────────────────

function InstallerCard({ group }: { group: DailyInstallerGroup }) {
    return (
        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-[#1E1E1E] rounded-lg overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#1E1E1E] bg-gray-50 dark:bg-[#1a1a1a]">
                <div className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-[#F5A800]" />
                    <span className="font-semibold text-gray-900 dark:text-white text-sm">
                        {group.employee_name}
                    </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                        <Car className="h-3 w-3" />
                        {group.total_cars} {group.total_cars === 1 ? 'carro' : 'carros'}
                    </span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(group.total_revenue)}
                    </span>
                </div>
            </div>

            {/* Vehicles table */}
            {group.vehicles.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-400">Nenhum veiculo no dia.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                                <th className="px-4 py-2 font-medium">O.S.</th>
                                <th className="px-4 py-2 font-medium">Placa</th>
                                <th className="px-4 py-2 font-medium">Veiculo</th>
                                <th className="px-4 py-2 font-medium">Loja</th>
                                <th className="px-4 py-2 font-medium">Servicos</th>
                                <th className="px-4 py-2 font-medium">Tipo</th>
                                <th className="px-4 py-2 font-medium text-right">Valor</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-[#1E1E1E]">
                            {group.vehicles.map((row) => {
                                const osLabel = row.external_os_number ?? row.order_number ?? `#${row.os_id}`;
                                return (
                                    <tr
                                        key={row.os_id}
                                        className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                                    >
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
                                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400 max-w-[200px]">
                                            <span className="truncate align-middle">
                                                {row.services.join(' + ') || '—'}
                                            </span>
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
                                                {formatCurrency(row.value)}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        {/* Card footer totals */}
                        <tfoot>
                            <tr className="border-t border-gray-200 dark:border-[#1E1E1E] bg-gray-50 dark:bg-[#1a1a1a]">
                                <td colSpan={4} className="px-4 py-2 text-xs text-gray-500">
                                    Total: {group.total_cars} {group.total_cars === 1 ? 'carro' : 'carros'}
                                </td>
                                <td />
                                <td />
                                <td className="px-4 py-2 text-right font-semibold text-gray-900 dark:text-white text-xs">
                                    {formatCurrency(group.total_revenue)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InstallerDailyPage() {
    const { availableStores } = useStoreStore();
    const [storeId, setStoreId] = useState<number | null>(null);
    const [date, setDate] = useState<string>(todayLocal);
    const [selectedInstallerIds, setSelectedInstallerIds] = useState<number[]>([]);
    const [isExporting, setIsExporting] = useState(false);

    // Load installers (Instalador de Pelicula, all stores)
    const { data: installers = [], isLoading: isLoadingInstallers } = useQuery({
        queryKey: ['employees', 'installers-all-stores'],
        queryFn: () =>
            employeesService
                .list({ position: FILM_INSTALLER_POSITION, is_active: true }, 1, 500)
                .then((r) => r.employees),
        staleTime: 1000 * 60 * 10,
    });

    const filters = {
        date,
        store_id: storeId ?? undefined,
        employee_ids: selectedInstallerIds.length > 0 ? selectedInstallerIds : undefined,
    };

    const { data, isLoading, isError, refetch } = useInstallerDaily(filters);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const blob = await installerPerformanceService.exportDaily({
                date,
                store_id: storeId ?? undefined,
                employee_ids: selectedInstallerIds.length > 0 ? selectedInstallerIds : undefined,
            });
            downloadBlob(blob, `desempenho_instaladores_${date}.pdf`);
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
                        Producao diaria por instalador
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={isExporting || isLoading}
                    className="flex items-center gap-2 self-start sm:self-auto"
                    aria-label="Exportar relatorio diario em PDF"
                >
                    <FileDown className="h-4 w-4" />
                    {isExporting ? 'Gerando PDF...' : 'Exportar PDF'}
                </Button>
            </div>

            {/* Tab navigation */}
            <TabNav />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 items-end flex-wrap">
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Loja
                    </span>
                    <Select
                        value={storeId === null ? 'all' : String(storeId)}
                        onValueChange={(v) => setStoreId(v === 'all' ? null : Number(v))}
                    >
                        <SelectTrigger className="w-48 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                            <SelectValue placeholder="Todas as Lojas" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                            <SelectItem value="all" className="focus:bg-zinc-700 focus:text-white">
                                Todas as Lojas
                            </SelectItem>
                            {availableStores.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)} className="focus:bg-zinc-700 focus:text-white">
                                    {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="daily-date" className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Data
                    </label>
                    <Input
                        id="daily-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-48"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Instalador
                    </span>
                    <InstallerMultiSelect
                        employees={installers}
                        isLoading={isLoadingInstallers}
                        value={selectedInstallerIds}
                        onChange={setSelectedInstallerIds}
                    />
                </div>
            </div>

            {/* Grand total summary */}
            {data && (
                <div className="flex items-center gap-6 px-4 py-3 bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#1E1E1E] rounded-lg text-sm">
                    <span className="text-gray-500 dark:text-gray-400">
                        Total do dia:
                    </span>
                    <span className="flex items-center gap-1 font-medium text-gray-900 dark:text-white">
                        <Car className="h-4 w-4 text-[#F5A800]" />
                        {data.grand_total_cars} {data.grand_total_cars === 1 ? 'carro' : 'carros'}
                    </span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(data.grand_total_revenue)}
                    </span>
                    {data.store_name && (
                        <span className="text-gray-400 dark:text-gray-500 ml-auto text-xs">
                            {data.store_name}
                        </span>
                    )}
                </div>
            )}

            {/* Content */}
            {isLoading ? (
                <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-40 w-full rounded-lg" />
                    ))}
                </div>
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
            ) : !data || data.groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <Car className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                    <p className="text-base font-medium text-gray-500 dark:text-gray-400">
                        Nenhum carro finalizado no dia
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">
                        Selecione outra data ou verifique os filtros.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {data.groups.map((group) => (
                        <InstallerCard key={group.employee_id} group={group} />
                    ))}
                </div>
            )}
        </div>
    );
}
