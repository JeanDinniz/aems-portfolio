import { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FileDown, Car, AlertCircle, DollarSign, Star, Layers, ChevronUp, ChevronDown as ChevronDownIcon } from 'lucide-react';
import { useInstallerSummary } from '@/hooks/useInstallerPerformance';
import installerPerformanceService from '@/services/api/installerPerformance.service';
import { useStoreStore } from '@/stores/store.store';
import { KpiCard } from '@/components/features/dashboard/KpiCard';
import { formatCurrency, cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SummaryFilters, SummaryRankingRow } from '@/types/installerPerformance.types';

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

// ─── Sorting types ────────────────────────────────────────────────────────────

type SortKey = keyof Pick<SummaryRankingRow, 'employee_name' | 'orders_count' | 'services_count' | 'cars_count' | 'points' | 'revenue'>;
type SortDir = 'asc' | 'desc';

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

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
    if (!active) {
        return (
            <span className="inline-flex flex-col ml-1 opacity-30">
                <ChevronUp className="h-2.5 w-2.5 -mb-0.5" />
                <ChevronDownIcon className="h-2.5 w-2.5" />
            </span>
        );
    }
    return dir === 'asc'
        ? <ChevronUp className="inline ml-1 h-3 w-3 text-[#F5A800]" />
        : <ChevronDownIcon className="inline ml-1 h-3 w-3 text-[#F5A800]" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InstallerSummaryPage() {
    const { availableStores } = useStoreStore();
    const [start, setStart] = useState<string>(firstDayOfMonthLocal);
    const [end, setEnd] = useState<string>(todayLocal);
    const [storeId, setStoreId] = useState<number | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('points');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const filters: SummaryFilters = {
        start,
        end,
        store_id: storeId,
    };

    const { data, isLoading, isError, refetch } = useInstallerSummary(filters);

    const sortedRows = useMemo(() => {
        if (!data) return [];
        const rows = [...data.rows];
        rows.sort((a, b) => {
            const aVal = a[sortKey];
            const bVal = b[sortKey];
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return sortDir === 'asc'
                    ? aVal.localeCompare(bVal, 'pt-BR')
                    : bVal.localeCompare(aVal, 'pt-BR');
            }
            const aNum = aVal as number;
            const bNum = bVal as number;
            return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
        });
        return rows;
    }, [data, sortKey, sortDir]);

    function handleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    }

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const blob = await installerPerformanceService.exportSummary(filters);
            downloadBlob(
                blob,
                `resumo_instaladores_${filters.start}_${filters.end}.pdf`
            );
        } catch {
            // error is surfaced via QueryCache globally
        } finally {
            setIsExporting(false);
        }
    };

    type ThButtonProps = {
        label: string;
        sortKeyName: SortKey;
        className?: string;
    };

    function ThButton({ label, sortKeyName, className }: ThButtonProps) {
        return (
            <th
                className={cn('px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap', className)}
                onClick={() => handleSort(sortKeyName)}
                aria-sort={sortKey === sortKeyName ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
                {label}
                <SortIcon active={sortKey === sortKeyName} dir={sortDir} />
            </th>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                        Desempenho de Instaladores
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        Resumo do periodo — todos os instaladores
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={isExporting || isLoading}
                    className="flex items-center gap-2 self-start sm:self-auto"
                    aria-label="Gerar PDF do resumo"
                >
                    <FileDown className="h-4 w-4" />
                    {isExporting ? 'Gerando PDF...' : 'Gerar PDF'}
                </Button>
            </div>

            {/* Tab navigation */}
            <TabNav />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-end">
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
                    <label htmlFor="sum-start" className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Inicio
                    </label>
                    <Input
                        id="sum-start"
                        type="date"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className="w-44"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="sum-end" className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Fim
                    </label>
                    <Input
                        id="sum-end"
                        type="date"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        className="w-44"
                    />
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-24 rounded-lg" />
                        ))}
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
                    {/* Period summary */}
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDateBR(data.period_start)} a {formatDateBR(data.period_end)}
                        {data.store_name && (
                            <span className="ml-2 text-xs text-gray-400">· {data.store_name}</span>
                        )}
                    </div>

                    {/* KPI cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <KpiCard
                            label="Total de Carros"
                            value={String(data.totals.total_cars)}
                            icon={Car}
                            delta={null}
                        />
                        <KpiCard
                            label="Total de Servicos"
                            value={data.totals.total_services.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            icon={Layers}
                            delta={null}
                        />
                        <KpiCard
                            label="Pontos"
                            value={data.totals.total_points.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            icon={Star}
                            delta={null}
                        />
                        <KpiCard
                            label="Faturamento"
                            value={formatCurrency(data.totals.total_revenue)}
                            icon={DollarSign}
                            delta={null}
                        />
                        <KpiCard
                            label="Custo de Peliculas"
                            value={formatCurrency(data.totals.film_cost)}
                            icon={DollarSign}
                            delta={null}
                        />
                    </div>

                    {/* Ranking table */}
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
                                            <ThButton label="Nome" sortKeyName="employee_name" />
                                            <ThButton label="O.S." sortKeyName="orders_count" />
                                            <ThButton label="Servicos" sortKeyName="services_count" />
                                            <ThButton label="Carros" sortKeyName="cars_count" />
                                            <ThButton label="Pontos" sortKeyName="points" />
                                            <ThButton label="Total Faturado" sortKeyName="revenue" className="text-right" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-[#1E1E1E]">
                                        {sortedRows.map((row) => (
                                            <tr
                                                key={row.employee_id}
                                                className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                                            >
                                                <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                                    {row.employee_name}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                                                    {row.orders_count}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                                                    {row.services_count.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                                                    {row.cars_count}
                                                </td>
                                                <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                                                    {row.points.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium text-gray-900 dark:text-white">
                                                    {formatCurrency(row.revenue)}
                                                </td>
                                            </tr>
                                        ))}
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
