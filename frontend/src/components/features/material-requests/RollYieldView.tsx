import { useMemo, useState } from 'react';
import { Search, Film, Car, TrendingUp } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useStores } from '@/hooks/useStores';
import { useRollYield, useRollServiceOrders } from '@/hooks/useMaterialRequests';
import type { RollYieldGroup, RollYieldEntry } from '@/types/materialRequest.types';

function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// Cor do chip da bobina conforme status
function rollChipClasses(status: string): string {
    switch (status) {
        case 'esgotada':
            return 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40';
        case 'em_uso':
            return 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30';
        default: // em_estoque
            return 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30';
    }
}

const STATUS_LABEL: Record<string, string> = {
    esgotada: 'Esgotada',
    em_uso: 'Em uso',
    em_estoque: 'Em estoque',
};

// ─── Roll drill-down dialog ───────────────────────────────────────────────────

interface RollDrilldownDialogProps {
    rollId: number | null;
    onClose: () => void;
}

function RollDrilldownDialog({ rollId, onClose }: RollDrilldownDialogProps) {
    const { data, isLoading } = useRollServiceOrders(rollId);

    return (
        <Dialog open={rollId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-2xl bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                <DialogHeader>
                    <DialogTitle className="text-base font-semibold text-[#111111] dark:text-white">
                        {data
                            ? (
                                <>
                                    {data.film_type_name}
                                    {data.tonality ? (
                                        <span className="font-normal text-[#666666] dark:text-zinc-400">
                                            {' '}— {data.tonality}
                                        </span>
                                    ) : null}
                                    <span className="ml-2 text-xs font-normal text-[#888888] dark:text-zinc-500">
                                        recebida {formatDateBR(data.receipt_date)}
                                    </span>
                                </>
                            )
                            : 'Carros desta bobina'
                        }
                    </DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="space-y-2 py-2">
                        {[...Array(4)].map((_, i) => (
                            <Skeleton key={i} className="h-8 w-full rounded" />
                        ))}
                    </div>
                ) : !data || data.rows.length === 0 ? (
                    <div className="py-10 flex flex-col items-center gap-2 text-center">
                        <Car className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Nenhum carro registrado para esta bobina.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="border-b border-[#E8E8E8] dark:border-[#333333]">
                                    {['Placa', 'Data', 'Serviço', 'Instalador', 'Metros'].map((h) => (
                                        <th
                                            key={h}
                                            className="text-left py-2 px-3 text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide whitespace-nowrap"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => (
                                    <tr
                                        key={row.service_order_id}
                                        className="border-b border-[#F0F0F0] dark:border-[#2a2a2a] hover:bg-zinc-50 dark:hover:bg-[#1E1E1E] transition-colors"
                                    >
                                        <td className="py-2 px-3 font-mono text-xs font-semibold text-[#111111] dark:text-white whitespace-nowrap">
                                            {row.vehicle_plate}
                                        </td>
                                        <td className="py-2 px-3 text-xs text-[#444444] dark:text-zinc-300 whitespace-nowrap">
                                            {row.service_date ? formatDateBR(row.service_date) : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-xs text-[#444444] dark:text-zinc-300">
                                            {row.service_code ?? row.service_name ?? '—'}
                                        </td>
                                        <td className="py-2 px-3 text-xs text-[#444444] dark:text-zinc-300">
                                            {row.installers.length > 0 ? row.installers.join(', ') : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-xs text-[#444444] dark:text-zinc-300 whitespace-nowrap">
                                            {row.meters_consumed != null ? `${row.meters_consumed}m` : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─── Roll chip ────────────────────────────────────────────────────────────────

interface RollChipProps {
    roll: RollYieldEntry;
    onClick: (rollId: number) => void;
}

function RollChip({ roll, onClick }: RollChipProps) {
    return (
        <button
            type="button"
            onClick={() => onClick(roll.roll_id)}
            className={
                'shrink-0 w-[104px] rounded-lg border px-2.5 py-2 text-center transition-all ' +
                'hover:shadow-md hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A800] ' +
                rollChipClasses(roll.status)
            }
            title={`${STATUS_LABEL[roll.status] ?? roll.status} · recebida ${formatDateBR(roll.receipt_date)} — clique para ver os carros`}
            aria-label={`Ver carros da bobina recebida em ${formatDateBR(roll.receipt_date)}`}
        >
            <div className="text-lg font-bold text-[#111111] dark:text-white leading-none">
                {roll.cars}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[#666666] dark:text-zinc-400 mt-0.5">
                carros
            </div>
            <div className="mt-1.5 text-xs font-medium text-[#444444] dark:text-zinc-300">
                {roll.total_meters}m
            </div>
            <div className="text-[10px] text-[#888888] dark:text-zinc-500">
                {formatDateBR(roll.receipt_date)}
            </div>
        </button>
    );
}

// ─── Yield card ───────────────────────────────────────────────────────────────

interface YieldCardProps {
    group: RollYieldGroup;
    showStore: boolean;
    onRollClick: (rollId: number) => void;
}

function YieldCard({ group, showStore, onRollClick }: YieldCardProps) {
    return (
        <div className="border border-[#E8E8E8] dark:border-[#333333] rounded-xl p-4 bg-white dark:bg-[#1C1C1C] space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#111111] dark:text-white">
                            {group.film_type_name}
                            {group.tonality ? (
                                <span className="text-[#666666] dark:text-zinc-400 font-normal">
                                    {' '}
                                    — {group.tonality}
                                </span>
                            ) : null}
                        </div>
                        {showStore && (
                            <div className="text-xs text-[#666666] dark:text-zinc-400">
                                {group.store_name ?? `Loja ${group.store_id}`}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-2 py-1 rounded-full font-medium">
                        <TrendingUp className="w-3 h-3" />
                        média {group.avg_cars} carros/bobina
                    </div>
                    <div className="flex items-center gap-1 text-xs bg-zinc-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 px-2 py-1 rounded-full">
                        <Car className="w-3 h-3" />
                        {group.total_cars} em {group.roll_count} bobina
                        {group.roll_count === 1 ? '' : 's'}
                    </div>
                </div>
            </div>

            {/* Bobinas recentes (mais recente à esquerda) */}
            <div className="flex gap-2 overflow-x-auto py-2 -my-1 px-1 -mx-1">
                {group.rolls.map((roll) => (
                    <RollChip key={roll.roll_id} roll={roll} onClick={onRollClick} />
                ))}
            </div>
        </div>
    );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function RollYieldView() {
    const { allStores } = useStores();
    const [storeFilter, setStoreFilter] = useState<string>('');
    const [search, setSearch] = useState('');
    const [selectedRollId, setSelectedRollId] = useState<number | null>(null);

    const { data, isLoading } = useRollYield({
        store_id: storeFilter ? Number(storeFilter) : undefined,
        per_material: 7,
    });

    const groups = useMemo(() => {
        const all = data?.items ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter(
            (g) =>
                g.film_type_name.toLowerCase().includes(q) ||
                (g.tonality ?? '').toLowerCase().includes(q)
        );
    }, [data, search]);

    const showStore = !storeFilter; // se filtrou uma loja, não repete o nome em cada card

    return (
        <div className="space-y-4">
            <p className="text-sm text-[#666666] dark:text-zinc-400">
                Quantos carros cada bobina rendeu, calculado automaticamente das O.S. finalizadas.
                Use como base na hora de fazer o pedido — as bobinas mais recentes aparecem à
                esquerda. <span className="font-medium text-[#444444] dark:text-zinc-300">Clique em uma bobina para ver os carros.</span>
            </p>

            {/* Filtros */}
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <Label className="text-xs text-[#666666] dark:text-zinc-400">Loja</Label>
                    <Select
                        value={storeFilter || '__all__'}
                        onValueChange={(v) => setStoreFilter(v === '__all__' ? '' : v)}
                    >
                        <SelectTrigger className="h-9 bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-300">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">Todas as lojas</SelectItem>
                            {allStores.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                    {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                    <Label className="text-xs text-[#666666] dark:text-zinc-400">Material</Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#999999]" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filtrar por tipo/tonalidade (ex: Insuline, G20)"
                            className="h-9 pl-8 bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333]"
                        />
                    </div>
                </div>
            </div>

            {/* Conteúdo */}
            {isLoading ? (
                <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-xl" />
                    ))}
                </div>
            ) : groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <TrendingUp className="w-7 h-7 text-amber-600" />
                    </div>
                    <p className="text-base font-medium text-[#111111] dark:text-white">
                        Sem dados de rendimento ainda
                    </p>
                    <p className="text-sm text-[#666666] dark:text-zinc-400 max-w-md">
                        O rendimento aparece conforme as bobinas são consumidas nas O.S. Assim que
                        houver consumo, os carros por bobina aparecem aqui.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {groups.map((g) => (
                        <YieldCard
                            key={`${g.store_id}-${g.film_type_id}-${g.tonality ?? ''}`}
                            group={g}
                            showStore={showStore}
                            onRollClick={setSelectedRollId}
                        />
                    ))}
                </div>
            )}

            {/* Drill-down dialog */}
            <RollDrilldownDialog
                rollId={selectedRollId}
                onClose={() => setSelectedRollId(null)}
            />
        </div>
    );
}
