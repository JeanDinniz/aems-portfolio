import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, RotateCcw, FileDown } from 'lucide-react';
import { useInstallerReturns } from '@/hooks/useInstallerPerformance';
import installerPerformanceService from '@/services/api/installerPerformance.service';
import { useStoreStore } from '@/stores/store.store';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ReturnsFilters } from '@/types/installerPerformance.types';

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

function dash(value: string | null | undefined): string {
    if (!value) return '—';
    return value;
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

function joinOrDash(arr: string[] | null | undefined): string {
    if (!arr || arr.length === 0) return '—';
    return arr.join(', ');
}

/** Texto completo para o tooltip nativo (title); undefined quando vazio, para não exibir tooltip inútil. */
function titleText(value: string | null | undefined): string | undefined {
    return value || undefined;
}

function joinTitle(arr: string[] | null | undefined): string | undefined {
    return arr && arr.length > 0 ? arr.join(', ') : undefined;
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InstallerReturnsPage() {
    const { availableStores } = useStoreStore();
    const [start, setStart] = useState<string>(firstDayOfMonthLocal);
    const [end, setEnd] = useState<string>(todayLocal);
    const [storeId, setStoreId] = useState<number | null>(null);

    const [isExporting, setIsExporting] = useState(false);

    const filters: ReturnsFilters = {
        start,
        end,
        store_id: storeId,
    };

    const { data, isLoading, isError, refetch } = useInstallerReturns(filters);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const blob = await installerPerformanceService.exportReturns(filters);
            downloadBlob(blob, `retornos_instaladores_${start}_${end}.pdf`);
        } catch {
            // error is surfaced via QueryCache globally
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                        Desempenho de Instaladores
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        Retornos do periodo
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={isExporting || isLoading}
                    className="flex items-center gap-2 self-start sm:self-auto"
                    aria-label="Gerar PDF dos retornos"
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
                    <label htmlFor="ret-start" className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Inicio
                    </label>
                    <Input
                        id="ret-start"
                        type="date"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className="w-44"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="ret-end" className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Fim
                    </label>
                    <Input
                        id="ret-end"
                        type="date"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        className="w-44"
                    />
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <Skeleton className="h-64 rounded-lg" />
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
                        <span className="ml-2 text-xs text-gray-400">
                            · {data.rows.length} retorno{data.rows.length !== 1 ? 's' : ''}
                        </span>
                    </div>

                    {/* Table */}
                    {data.rows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                            <RotateCcw className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                            <p className="text-base font-medium text-gray-500 dark:text-gray-400">
                                Nenhum retorno no periodo
                            </p>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-[#161616] border border-gray-200 dark:border-[#1E1E1E] rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-left text-gray-400 dark:text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-[#1E1E1E]">
                                            {/* Return columns */}
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">Data retorno</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">Quem fez (retorno)</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">Obs. retorno</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">O que foi feito (retorno)</th>
                                            {/* Origin columns */}
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap border-l border-gray-100 dark:border-[#2a2a2a]">Data anterior</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">Quem fez (anterior)</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">Obs. anterior</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">O que foi feito (anterior)</th>
                                            {/* Vehicle columns */}
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap border-l border-gray-100 dark:border-[#2a2a2a]">Modelo</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">Chassi</th>
                                            <th className="px-4 py-2.5 font-medium whitespace-nowrap">Cor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-[#1E1E1E]">
                                        {data.rows.map((row) => (
                                            <tr
                                                key={row.return_os_id}
                                                className="hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
                                            >
                                                {/* Return data */}
                                                <td className="px-4 py-2.5 text-gray-900 dark:text-white whitespace-nowrap font-medium">
                                                    {formatDateBR(row.return_date)}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap" title={joinTitle(row.return_workers)}>
                                                    {joinOrDash(row.return_workers)}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 max-w-[200px]">
                                                    <span className="line-clamp-2" title={titleText(row.return_notes)}>{dash(row.return_notes)}</span>
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap" title={joinTitle(row.return_services)}>
                                                    {joinOrDash(row.return_services)}
                                                </td>
                                                {/* Origin data */}
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap border-l border-gray-100 dark:border-[#2a2a2a]">
                                                    {row.origin_date ? formatDateBR(row.origin_date) : '—'}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap" title={joinTitle(row.origin_workers)}>
                                                    {joinOrDash(row.origin_workers)}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 max-w-[200px]">
                                                    <span className="line-clamp-2" title={titleText(row.origin_notes)}>{dash(row.origin_notes)}</span>
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap" title={joinTitle(row.origin_services)}>
                                                    {joinOrDash(row.origin_services)}
                                                </td>
                                                {/* Vehicle data */}
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap border-l border-gray-100 dark:border-[#2a2a2a]" title={titleText(row.model)}>
                                                    {dash(row.model)}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap" title={titleText(row.chassis)}>
                                                    {dash(row.chassis)}
                                                </td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap" title={titleText(row.color)}>
                                                    {dash(row.color)}
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
