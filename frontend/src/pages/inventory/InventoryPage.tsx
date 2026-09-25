import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Plus,
    Loader2,
    Package,
    AlertTriangle,
    ChevronRight,
    ChevronDown,
    CalendarDays,
    Layers,
    Download,
    Trash2,
    Eye,
    EyeOff,
    AlertCircle,
    Scissors,
    PackageOpen,
    ArrowLeftRight,
    Pencil,
} from 'lucide-react';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatFilmRollName } from '@/utils/filmRoll';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { useOpenRoll } from '@/hooks/useOpenRoll';
import { useAdjustRollMeters } from '@/hooks/useAdjustRollMeters';
import { useUpdateRoll } from '@/hooks/useUpdateRoll';
import { useStoreStore } from '@/stores/store.store';
import { useAuthStore } from '@/stores/auth.store';
import { WithdrawalModal } from '@/pages/inventory/WithdrawalModal';
import { WithdrawalsSection } from '@/pages/inventory/WithdrawalsSection';
import { inventoryService } from '@/services/api/inventory.service';
import { storesService, type Store as StoreData } from '@/services/api/stores.service';
import { useSuppliers } from '@/hooks/useSuppliers';
import { FILM_TONALITY_OPTIONS } from '@/constants/scheduling';
import type {
    FilmRoll,
    FilmRollColor,
    FilmConsumption,
    CreateFilmRollPayload,
    FilmType,
    TonalityForecastDetail,
} from '@/services/api/inventory.service';

// ─── Color helpers ────────────────────────────────────────────────────────────

const COLOR_CONFIG = {
    blue:   { dot: 'bg-blue-500',   bar: 'bg-blue-500',   badge: 'Em Estoque', badgeCls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    green:  { dot: 'bg-green-500',  bar: 'bg-green-500',  badge: 'Em Uso',     badgeCls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    yellow: { dot: 'bg-yellow-400', bar: 'bg-yellow-400', badge: 'Alerta',     badgeCls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    red:    { dot: 'bg-red-500',    bar: 'bg-red-500',    badge: 'Esgotado',   badgeCls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
} as const;

const COLOR_PRIORITY: Record<FilmRollColor, number> = { red: 4, yellow: 3, green: 2, blue: 1 };

function worstColor(colors: FilmRollColor[]): FilmRollColor {
    if (colors.length === 0) return 'blue';
    return colors.reduce<FilmRollColor>((worst, c) =>
        COLOR_PRIORITY[c] > COLOR_PRIORITY[worst] ? c : worst,
        'blue'
    );
}

// ─── Grouping types ──────────────────────────────────────────────────────────

interface RollGroup {
    tonality: string | null;
    rolls: FilmRoll[];
}

interface FilmTypeGroup {
    film_type_id: number;
    film_type_name: string;
    tonalities: RollGroup[];
    isPPF: boolean;
    department: string;
}

interface StoreGroup {
    store_id: number;
    store_name: string;
    filmTypes: FilmTypeGroup[];
}

function groupByStore(rolls: FilmRoll[], filmTypesMap: Map<number, FilmType>): StoreGroup[] {
    const storeMap = new Map<number, Map<number, Map<string, FilmRoll[]>>>();
    const storeNames = new Map<number, string>();

    for (const roll of rolls) {
        storeNames.set(roll.store_id, roll.store_name ?? `Loja ${roll.store_id}`);
        if (!storeMap.has(roll.store_id)) {
            storeMap.set(roll.store_id, new Map());
        }
        const byType = storeMap.get(roll.store_id)!;
        if (!byType.has(roll.film_type_id)) {
            byType.set(roll.film_type_id, new Map());
        }
        const byTonality = byType.get(roll.film_type_id)!;
        const tonalityKey = roll.tonality ?? '__ppf__';
        if (!byTonality.has(tonalityKey)) {
            byTonality.set(tonalityKey, []);
        }
        byTonality.get(tonalityKey)!.push(roll);
    }

    const storeGroups: StoreGroup[] = [];

    for (const [storeId, byType] of storeMap.entries()) {
        const filmTypeGroups: FilmTypeGroup[] = [];

        for (const [filmTypeId, byTonality] of byType.entries()) {
            const filmType = filmTypesMap.get(filmTypeId);
            const isPPF = filmType?.department === 'ppf';
            const sampleRoll = [...byTonality.values()][0]?.[0];
            const filmTypeName = filmType?.name ?? sampleRoll?.film_type_name ?? `Tipo ${filmTypeId}`;

            const tonalityGroups: RollGroup[] = [];
            for (const [tonalityKey, tonalityRolls] of byTonality.entries()) {
                tonalityGroups.push({
                    tonality: tonalityKey === '__ppf__' ? null : tonalityKey,
                    rolls: tonalityRolls,
                });
            }

            // Sort tonalities alphabetically (null last)
            tonalityGroups.sort((a, b) => {
                if (a.tonality === null) return 1;
                if (b.tonality === null) return -1;
                return a.tonality.localeCompare(b.tonality);
            });

            filmTypeGroups.push({
                film_type_id: filmTypeId,
                film_type_name: filmTypeName,
                tonalities: tonalityGroups,
                isPPF,
                department: filmType?.department ?? 'film',
            });
        }

        // Sort film types alphabetically
        filmTypeGroups.sort((a, b) => a.film_type_name.localeCompare(b.film_type_name));

        storeGroups.push({
            store_id: storeId,
            store_name: storeNames.get(storeId)!,
            filmTypes: filmTypeGroups,
        });
    }

    // Sort stores by name
    storeGroups.sort((a, b) => a.store_name.localeCompare(b.store_name));

    return storeGroups;
}

// ─── Shared inventory merging ─────────────────────────────────────────────────

type InventoryGroup = { storeIds: number[]; label: string }

function computeInventoryGroups(stores: StoreData[]): InventoryGroup[] {
    const groups: InventoryGroup[] = [];
    const processed = new Set<number>();

    for (const store of stores) {
        if (processed.has(store.id)) continue;
        processed.add(store.id);

        if (store.has_shared_inventory && store.linked_inventory_store_ids?.length > 0) {
            const partnerIds = store.linked_inventory_store_ids.filter((id) => !processed.has(id));
            const partners = stores.filter((s) => partnerIds.includes(s.id));
            partners.forEach((s) => processed.add(s.id));
            const allGroupStores = [store, ...partners];
            groups.push({
                storeIds: allGroupStores.map((s) => s.id),
                label: allGroupStores.map((s) => s.name).join(' + '),
            });
        } else {
            groups.push({ storeIds: [store.id], label: store.name });
        }
    }

    return groups;
}

/**
 * Merges tonality groups from multiple stores of a shared-inventory group:
 * groups with the same tonality (normalized) become a single row with all rolls.
 */
function mergeTonalityGroups(a: RollGroup[], b: RollGroup[]): RollGroup[] {
    const normKey = (t: string | null) => t?.trim().toUpperCase() ?? '__ppf__';
    const merged = new Map<string, RollGroup>();
    for (const group of [...a, ...b]) {
        const key = normKey(group.tonality);
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { tonality: group.tonality, rolls: [...group.rolls] });
        } else {
            existing.rolls = [...existing.rolls, ...group.rolls];
        }
    }
    const result = Array.from(merged.values());
    result.sort((x, y) => {
        if (x.tonality === null) return 1;
        if (y.tonality === null) return -1;
        return x.tonality.localeCompare(y.tonality);
    });
    return result;
}

/**
 * Merges multiple StoreGroups (one per store_id) into a single StoreGroup
 * representing a shared-inventory group. Film type groups across stores are
 * concatenated so they all appear under one card.
 */
function mergeStoreGroupsForDisplay(
    storeGroups: StoreGroup[],
    inventoryGroups: InventoryGroup[]
): (StoreGroup & { displayName: string })[] {
    const storeGroupMap = new Map(storeGroups.map((sg) => [sg.store_id, sg]));
    const result: (StoreGroup & { displayName: string })[] = [];

    for (const group of inventoryGroups) {
        const matched = group.storeIds
            .map((id) => storeGroupMap.get(id))
            .filter((sg): sg is StoreGroup => sg !== undefined);

        if (matched.length === 0) continue;

        if (matched.length === 1) {
            result.push({ ...matched[0], displayName: matched[0].store_name });
        } else {
            // Merge film types across stores: same film_type_id → merge tonalities
            const primary = matched[0];
            const filmTypeMap = new Map<number, FilmTypeGroup>();
            for (const sg of matched) {
                for (const ft of sg.filmTypes) {
                    const existing = filmTypeMap.get(ft.film_type_id);
                    if (!existing) {
                        filmTypeMap.set(ft.film_type_id, { ...ft, tonalities: [...ft.tonalities] });
                    } else {
                        existing.tonalities = mergeTonalityGroups(existing.tonalities, ft.tonalities);
                    }
                }
            }
            result.push({
                store_id: primary.store_id,
                store_name: primary.store_name,
                filmTypes: Array.from(filmTypeMap.values()),
                displayName: group.label,
            });
        }
    }

    // Track ALL store IDs covered by any merged group (not just the primary)
    // to avoid adding partner stores as standalone cards
    const representedIds = new Set<number>();
    for (const group of inventoryGroups) {
        const hasAnyMatch = group.storeIds.some((id) => storeGroupMap.has(id));
        if (hasAnyMatch) {
            group.storeIds.forEach((id) => representedIds.add(id));
        }
    }

    // Add stores with rolls that don't belong to any inventory group
    for (const sg of storeGroups) {
        if (!representedIds.has(sg.store_id)) {
            result.push({ ...sg, displayName: sg.store_name });
        }
    }

    return result;
}

function colorCountsForStore(group: StoreGroup): Record<FilmRollColor, number> {
    const counts: Record<FilmRollColor, number> = { blue: 0, green: 0, yellow: 0, red: 0 };
    for (const ft of group.filmTypes) {
        for (const tg of ft.tonalities) {
            for (const roll of tg.rolls) {
                counts[roll.color] = (counts[roll.color] ?? 0) + 1;
            }
        }
    }
    return counts;
}

function sumActiveMeters(rolls: FilmRoll[]): number {
    return rolls
        .filter((r) => r.status !== 'esgotada')
        .reduce((acc, r) => acc + r.remaining_meters, 0);
}

/** Formata metros removendo artefatos de ponto flutuante (ex: 27.299999… → "27.3") */
function formatMeters(value: number): string {
    return parseFloat(value.toFixed(2)).toString();
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── RollRow ─────────────────────────────────────────────────────────────────

function RollRow({ roll, onDetailClick }: {
    roll: FilmRoll;
    onDetailClick: (roll: FilmRoll) => void;
}) {
    const config = COLOR_CONFIG[roll.color];
    const pct = roll.total_meters > 0
        ? Math.round((roll.remaining_meters / roll.total_meters) * 100)
        : 0;

    return (
        <button
            type="button"
            onClick={() => onDetailClick(roll)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left group"
            title="Clique para ver detalhes"
        >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium truncate">{formatFilmRollName(roll)}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${config.badgeCls}`}>
                        {config.badge}
                    </span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                        className={`h-1.5 rounded-full transition-all ${config.bar}`}
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatMeters(roll.remaining_meters)}m / {formatMeters(roll.total_meters)}m
                </p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {formatDate(roll.receipt_date)}
            </div>
        </button>
    );
}

// ─── TonalityRow ─────────────────────────────────────────────────────────────

function TonalityRow({ group, onDetailClick }: {
    group: RollGroup;
    onDetailClick: (roll: FilmRoll) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const worst = worstColor(group.rolls.map((r) => r.color));
    const activeMeters = sumActiveMeters(group.rolls);

    return (
        <div>
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors text-left"
            >
                {expanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                }
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${COLOR_CONFIG[worst].dot}`} />
                <span className="text-xs font-medium flex-1">
                    {group.tonality ?? 'Sem tonalidade'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                    {formatMeters(activeMeters)}m restantes
                </span>
                <span className="text-[10px] text-muted-foreground ml-1">
                    ({group.rolls.length} bobina{group.rolls.length !== 1 ? 's' : ''})
                </span>
            </button>
            {expanded && (
                <div className="ml-4 space-y-0.5">
                    {group.rolls.map((roll) => (
                        <RollRow key={roll.id} roll={roll} onDetailClick={onDetailClick} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── FilmTypeRow ──────────────────────────────────────────────────────────────

function FilmTypeRow({ group, onDetailClick, onForecastClick, storeId }: {
    group: FilmTypeGroup;
    onDetailClick: (roll: FilmRoll) => void;
    onForecastClick: (filmTypeId: number, storeId: number) => void;
    storeId: number;
}) {
    const [expanded, setExpanded] = useState(false);
    const allRolls = group.tonalities.flatMap((t) => t.rolls);
    const worst = worstColor(allRolls.map((r) => r.color));
    const activeMeters = sumActiveMeters(allRolls);

    return (
        <div className="border border-border/50 rounded-lg overflow-hidden">
            <div className="flex items-center bg-muted/20 hover:bg-muted/40 transition-colors">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="flex-1 flex items-center gap-2 px-4 py-2.5 text-left"
                >
                    {expanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    }
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${COLOR_CONFIG[worst].dot}`} />
                    <span className="text-sm font-semibold flex-1">{group.film_type_name}</span>
                    {group.isPPF && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                            PPF
                        </span>
                    )}
                    {group.department === 'security_film' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400">
                            Seg.
                        </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                        {formatMeters(activeMeters)}m
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">
                        · {allRolls.length} bobina{allRolls.length !== 1 ? 's' : ''}
                    </span>
                </button>
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onForecastClick(group.film_type_id, storeId); }}
                    className="px-3 py-2.5 border-l border-border/40 text-muted-foreground hover:text-primary hover:bg-muted/60 transition-colors flex-shrink-0"
                    title="Ver previsão de consumo"
                >
                    <CalendarDays className="h-4 w-4" />
                </button>
            </div>
            {expanded && (
                <div className="p-2 space-y-0.5">
                    {group.isPPF
                        ? group.tonalities.flatMap((tg) =>
                            tg.rolls.map((roll) => (
                                <RollRow key={roll.id} roll={roll} onDetailClick={onDetailClick} />
                            ))
                          )
                        : group.tonalities.map((tg, i) => (
                            <TonalityRow
                                key={tg.tonality ?? i}
                                group={tg}
                                onDetailClick={onDetailClick}
                            />
                          ))
                    }
                </div>
            )}
        </div>
    );
}

// ─── StoreCard ────────────────────────────────────────────────────────────────

const DEPT_ORDER: { dept: string; label: string }[] = [
    { dept: 'film', label: 'Película' },
    { dept: 'security_film', label: 'Película de Segurança' },
    { dept: 'ppf', label: 'PPF' },
];

function StoreCard({ group, displayName, onDetailClick, onForecastClick }: {
    group: StoreGroup;
    displayName?: string;
    onDetailClick: (roll: FilmRoll) => void;
    onForecastClick: (filmTypeId: number, storeId: number) => void;
}) {
    const colorCounts = colorCountsForStore(group);
    const totalRolls = group.filmTypes.flatMap((ft) => ft.tonalities).flatMap((t) => t.rolls).length;
    const cardName = displayName ?? group.store_name;

    return (
        <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
            {/* Store header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">{cardName}</span>
                    <span className="text-xs text-muted-foreground">
                        ({totalRolls} bobina{totalRolls !== 1 ? 's' : ''})
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {(Object.entries(colorCounts) as [FilmRollColor, number][])
                        .filter(([, count]) => count > 0)
                        .map(([color, count]) => (
                            <span key={color} className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                                <span className={`w-2 h-2 rounded-full ${COLOR_CONFIG[color].dot}`} />
                                {count}
                            </span>
                        ))
                    }
                </div>
            </div>
            {/* Film types list grouped by category */}
            <div className="p-3 space-y-3">
                {DEPT_ORDER.map(({ dept, label }) => {
                    const types = group.filmTypes.filter((ft) => ft.department === dept);
                    if (types.length === 0) return null;
                    return (
                        <div key={dept}>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 py-1.5">
                                {label}
                            </p>
                            <div className="space-y-2">
                                {types.map((ft) => (
                                    <FilmTypeRow
                                        key={ft.film_type_id}
                                        group={ft}
                                        onDetailClick={onDetailClick}
                                        onForecastClick={onForecastClick}
                                        storeId={group.store_id}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Forecast helpers ─────────────────────────────────────────────────────────

const FORECAST_STATUS_CONFIG = {
    critical: {
        badge: 'CRÍTICO',
        badgeCls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        dot: 'bg-red-500',
        bar: 'bg-red-500',
        availableCls: 'text-red-600 dark:text-red-400',
        balanceCls: 'text-red-600 dark:text-red-400',
        borderCls: 'border-red-200 dark:border-red-800',
    },
    attention: {
        badge: 'ATENÇÃO',
        badgeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        dot: 'bg-amber-400',
        bar: 'bg-amber-400',
        availableCls: 'text-amber-600 dark:text-amber-400',
        balanceCls: 'text-amber-600 dark:text-amber-400',
        borderCls: 'border-amber-200 dark:border-amber-800',
    },
    ok: {
        badge: 'OK',
        badgeCls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        dot: 'bg-green-500',
        bar: 'bg-green-500',
        availableCls: 'text-green-600 dark:text-green-400',
        balanceCls: 'text-green-600 dark:text-green-400',
        borderCls: 'border-border',
    },
} as const;

const TONALITY_VISIBLE_ROWS = 3;

function TonalityCard({ detail }: { detail: TonalityForecastDetail }) {
    const cfg = FORECAST_STATUS_CONFIG[detail.status];
    const tonalityLabel = detail.tonality ?? 'Sem tonalidade';
    const balanceIsNeg = detail.balance_meters < 0;
    const balanceLabel = balanceIsNeg
        ? `${detail.balance_meters.toFixed(1)}m`
        : `+${detail.balance_meters.toFixed(1)}m`;

    // Escala visual 0–400%; capped em 100% de largura para exibição
    const barWidth = Math.min((detail.usage_percentage / 400) * 100, 100);

    const visibleItems = detail.items.slice(0, TONALITY_VISIBLE_ROWS);
    const hiddenCount = detail.items.length - TONALITY_VISIBLE_ROWS;
    const hiddenMeters = hiddenCount > 0
        ? detail.items.slice(TONALITY_VISIBLE_ROWS).reduce((s, i) => s + i.meters_consumed, 0)
        : 0;

    return (
        <div className={`rounded-lg border ${cfg.borderCls} overflow-hidden flex flex-col`}>
            {/* Cabeçalho */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <span className="text-sm font-semibold flex-1 truncate">{tonalityLabel}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.badgeCls}`}>
                    {cfg.badge}
                </span>
            </div>

            {/* Métricas */}
            <div className="px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                    <p className="text-muted-foreground text-[10px]">Consumo previsto</p>
                    <p className="font-semibold">{detail.consumed_meters.toFixed(1)}m</p>
                </div>
                <div>
                    <p className="text-muted-foreground text-[10px]">Estoque disponível</p>
                    <p className={`font-semibold ${cfg.availableCls}`}>{detail.available_meters.toFixed(1)}m</p>
                </div>
                <div>
                    <p className="text-muted-foreground text-[10px]">Saldo após consumo</p>
                    <p className={`font-semibold ${balanceIsNeg ? cfg.balanceCls : 'text-green-600 dark:text-green-400'}`}>
                        {balanceLabel}
                    </p>
                </div>
                <div>
                    <p className="text-muted-foreground text-[10px]">O.S. agendadas</p>
                    <p className="font-semibold">{detail.scheduled_orders_count}</p>
                </div>
            </div>

            {/* Barra de progresso */}
            <div className="px-3 pb-2">
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Uso previsto do estoque</span>
                    <span>{detail.usage_percentage.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                        className={`h-1.5 rounded-full transition-all ${cfg.bar}`}
                        style={{ width: `${barWidth}%` }}
                    />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>0%</span>
                    <span>100%</span>
                    <span>200%</span>
                    <span>300%</span>
                    <span>400%</span>
                </div>
            </div>

            {/* Tabela de O.S. */}
            <div className="px-3 pb-3 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    O.S. que consomem esta tonalidade
                </p>
                {detail.items.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground text-center py-2">
                        Nenhuma O.S. agendada para esta tonalidade.
                    </p>
                ) : (
                    <div className="rounded border border-border overflow-hidden">
                        <table className="w-full text-[10px]">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Modelo</th>
                                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Placa</th>
                                    <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Serviço</th>
                                    <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Metros</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {visibleItems.map((item, i) => (
                                    <tr key={i} className="hover:bg-muted/30">
                                        <td className="px-2 py-1.5 truncate max-w-[60px]" title={item.vehicle_model ?? undefined}>{item.vehicle_model ?? '—'}</td>
                                        <td className="px-2 py-1.5">{item.vehicle_plate ?? '—'}</td>
                                        <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[60px]" title={item.service_name ?? undefined}>{item.service_name ?? '—'}</td>
                                        <td className="px-2 py-1.5 text-right font-medium">{item.meters_consumed.toFixed(1)}m</td>
                                    </tr>
                                ))}
                                {hiddenCount > 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-2 py-1.5 text-muted-foreground text-center italic">
                                            +{hiddenCount} O.S. · {hiddenMeters.toFixed(1)}m adicionais
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            <tfoot className="bg-muted/30 border-t border-border">
                                <tr>
                                    <td colSpan={3} className="px-2 py-1.5 font-semibold">Total</td>
                                    <td className="px-2 py-1.5 text-right font-bold">{detail.consumed_meters.toFixed(1)}m</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── ForecastModal ────────────────────────────────────────────────────────────

function ForecastModal({
    filmTypeId,
    storeId,
    filmTypeName,
    onClose,
}: {
    filmTypeId: number | null;
    storeId: number | null;
    filmTypeName: string;
    onClose: () => void;
}) {
    const { data, isLoading } = useQuery({
        queryKey: ['film-type-forecast', filmTypeId, storeId],
        queryFn: () => inventoryService.getForecast(filmTypeId!, storeId!),
        enabled: filmTypeId !== null && storeId !== null,
        staleTime: 0, // sempre busca dados frescos ao abrir o modal
    });

    const isOpen = filmTypeId !== null && storeId !== null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-primary" />
                        Previsão de Consumo — {data?.film_type_name ?? filmTypeName}
                    </DialogTitle>
                    <p className="text-sm text-muted-foreground">Consumo baseado nos serviços agendados</p>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : !data ? null : (
                    <div className="space-y-4 py-2">
                        {/* KPI Summary */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="rounded-lg border border-border p-3 text-center">
                                <p className="text-2xl font-bold">{data.tonalities_analyzed}</p>
                                <p className="text-xs font-medium text-foreground mt-0.5">Tonalidades analisadas</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">com bobinas cadastradas</p>
                            </div>
                            <div className="rounded-lg border border-border p-3 text-center">
                                <p className="text-2xl font-bold">{data.total_scheduled_meters.toFixed(1)}m</p>
                                <p className="text-xs font-medium text-foreground mt-0.5">Consumo total previsto</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">em todas tonalidades</p>
                            </div>
                            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-3 text-center">
                                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                                    {data.tonalities_attention_count}
                                </p>
                                <p className="text-xs font-medium text-foreground mt-0.5">Tonalidades em atenção</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">com estoque baixo</p>
                            </div>
                            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-3 text-center">
                                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                                    {data.tonalities_critical_count}
                                </p>
                                <p className="text-xs font-medium text-foreground mt-0.5">Tonalidades críticas</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">ficarão sem estoque</p>
                            </div>
                        </div>

                        {/* Banner informativo */}
                        <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
                            <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" />
                            <span>Período considerado: Serviços agendados a partir de hoje</span>
                        </div>

                        {/* Cards por tonalidade */}
                        {data.tonalities.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                Nenhuma tonalidade com bobinas cadastradas encontrada.
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {data.tonalities.map((detail, i) => (
                                    <TonalityCard key={detail.tonality ?? `ppf-${i}`} detail={detail} />
                                ))}
                            </div>
                        )}

                        {/* Alerta: itens sem tonalidade definida */}
                        {data.unattributed_items.length > 0 && (
                            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                                        {data.unattributed_items.length} O.S. sem tonalidade definida — {data.unattributed_meters.toFixed(1)}m não atribuídos
                                    </p>
                                </div>
                                <p className="text-[10px] text-amber-700 dark:text-amber-400 pl-5">
                                    Estas ordens usam este tipo de película mas não têm tonalidade registrada. Edite as O.S. para atribuir a tonalidade correta.
                                </p>
                                <div className="rounded border border-amber-200 dark:border-amber-700 overflow-hidden">
                                    <table className="w-full text-[10px]">
                                        <thead className="bg-amber-100/60 dark:bg-amber-900/30">
                                            <tr>
                                                <th className="text-left px-2 py-1.5 font-medium text-amber-800 dark:text-amber-300">Modelo</th>
                                                <th className="text-left px-2 py-1.5 font-medium text-amber-800 dark:text-amber-300">Placa</th>
                                                <th className="text-left px-2 py-1.5 font-medium text-amber-800 dark:text-amber-300">Serviço</th>
                                                <th className="text-right px-2 py-1.5 font-medium text-amber-800 dark:text-amber-300">Metros</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-amber-200 dark:divide-amber-800">
                                            {data.unattributed_items.map((item, i) => (
                                                <tr key={i} className="bg-white/50 dark:bg-transparent">
                                                    <td className="px-2 py-1.5 text-amber-900 dark:text-amber-200">{item.vehicle_model ?? '—'}</td>
                                                    <td className="px-2 py-1.5 text-amber-900 dark:text-amber-200">{item.vehicle_plate ?? '—'}</td>
                                                    <td className="px-2 py-1.5 text-amber-700 dark:text-amber-400 truncate max-w-[100px]" title={item.service_name ?? undefined}>{item.service_name ?? '—'}</td>
                                                    <td className="px-2 py-1.5 text-right font-medium text-amber-900 dark:text-amber-200">{item.meters_consumed.toFixed(1)}m</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="bg-amber-100/40 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-800">
                                            <tr>
                                                <td colSpan={3} className="px-2 py-1.5 font-semibold text-amber-800 dark:text-amber-300">Total não atribuído</td>
                                                <td className="px-2 py-1.5 text-right font-bold text-amber-800 dark:text-amber-300">{data.unattributed_meters.toFixed(1)}m</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Rodapé */}
                        <p className="text-[10px] text-muted-foreground text-center pt-1 border-t border-border">
                            Exibindo apenas tonalidades com bobinas cadastradas no estoque
                        </p>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ─── RollDetailModal ──────────────────────────────────────────────────────────

function RollDetailModal({ roll, onClose, onExhaust, isExhausting, onRestore, isRestoring, onTransfer, onDelete }: {
    roll: FilmRoll | null;
    onClose: () => void;
    onExhaust: (roll: FilmRoll) => void;
    isExhausting: boolean;
    onRestore: (roll: FilmRoll) => void;
    isRestoring: boolean;
    onTransfer?: (roll: FilmRoll) => void;
    onDelete?: (roll: FilmRoll) => void;
}) {
    const [isExportingRoll, setIsExportingRoll] = useState(false);

    // ── Adjust meters state ──────────────────────────────────────────────────
    const [adjustOpen, setAdjustOpen] = useState(false);
    const [adjustMeters, setAdjustMeters] = useState<number>(0);
    const [adjustNote, setAdjustNote] = useState('');

    const { toast } = useToast();
    const canEditInventory = useCanEdit('inventory');
    const openRoll = useOpenRoll();
    const adjustRollMutation = useAdjustRollMeters();
    const updateRollMutation = useUpdateRoll();

    // ── Edit roll state ──────────────────────────────────────────────────────
    const [editOpen, setEditOpen] = useState(false);
    const [editFilmTypeId, setEditFilmTypeId] = useState<number | null>(null);
    const [editTonality, setEditTonality] = useState('');
    const [editTotalMeters, setEditTotalMeters] = useState<number>(0);
    const [editSupplierId, setEditSupplierId] = useState<number | null>(null);
    const [editNfe, setEditNfe] = useState('');
    const [editCost, setEditCost] = useState('');
    const [editLot, setEditLot] = useState('');
    const [editReceipt, setEditReceipt] = useState('');

    const { data: editFilmTypesData } = useQuery({
        queryKey: ['film-types', 'all', 200],
        queryFn: () => inventoryService.listFilmTypes({ limit: 200 }),
        enabled: roll !== null,
        staleTime: 1000 * 60 * 10,
    });
    // Fornecedores só alimentam o <Select> do formulário de edição. Sem o gate,
    // esta query (mesma queryKey ['suppliers', undefined] do modal de Entrada)
    // dispararia no mount do RollDetailModal — que fica sempre montado — anulando
    // o carregamento sob demanda. Só busca quando a edição abre.
    const { data: editSuppliersData } = useSuppliers(undefined, { enabled: editOpen });

    const { data: consumptions, isLoading: loadingConsumptions } = useQuery({
        queryKey: ['roll-consumptions', roll?.id],
        queryFn: () => inventoryService.listRollConsumptions(roll!.id),
        enabled: roll !== null,
        staleTime: 1000 * 60 * 2,
    });

    if (!roll) return null;

    const editFilmTypes = editFilmTypesData?.items ?? [];
    const editSuppliers = editSuppliersData?.items ?? [];
    const editSelectedType = editFilmTypes.find((ft) => ft.id === editFilmTypeId);
    const editTonalities = editSelectedType?.available_tonalities ?? [];

    const handleOpenEdit = () => {
        setEditFilmTypeId(roll.film_type_id);
        setEditTonality(roll.tonality ?? '');
        setEditTotalMeters(roll.total_meters);
        setEditSupplierId(roll.supplier_id ?? null);
        setEditNfe(roll.nfe_number ?? '');
        setEditCost(roll.cost != null ? String(roll.cost) : '');
        setEditLot(roll.lot_number ?? '');
        setEditReceipt(roll.receipt_date);
        setAdjustOpen(false);
        setEditOpen(true);
    };

    const handleConfirmEdit = () => {
        updateRollMutation.mutate(
            {
                id: roll.id,
                payload: {
                    film_type_id: editFilmTypeId ?? undefined,
                    tonality: editTonality || null,
                    total_meters: editTotalMeters,
                    receipt_date: editReceipt || undefined,
                    supplier_id: editSupplierId ?? undefined,
                    clear_supplier: editSupplierId == null,
                    nfe_number: editNfe.trim() || undefined,
                    clear_nfe: !editNfe.trim(),
                    cost: editCost ? Number(editCost) : undefined,
                    clear_cost: !editCost,
                    lot_number: editLot.trim() || undefined,
                    clear_lot: !editLot.trim(),
                },
            },
            {
                onSuccess: () => {
                    setEditOpen(false);
                    onClose();
                },
            }
        );
    };

    const handleExportRoll = async () => {
        setIsExportingRoll(true);
        try {
            const blob = await inventoryService.exportRoll(roll.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${roll.visual_id.replace(/[\s[\]]/g, '_')}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast({ title: 'Erro ao exportar', description: getApiErrorMessage(err as Error, 'Tente novamente.'), variant: 'destructive' });
        } finally {
            setIsExportingRoll(false);
        }
    };

    const handleOpenAdjust = () => {
        setAdjustMeters(roll.remaining_meters);
        setAdjustNote('');
        setAdjustOpen(true);
    };

    const handleConfirmAdjust = () => {
        adjustRollMutation.mutate(
            { id: roll.id, remaining_meters: adjustMeters, note: adjustNote.trim() },
            {
                onSuccess: () => {
                    setAdjustOpen(false);
                    setAdjustNote('');
                },
            }
        );
    };

    const config = COLOR_CONFIG[roll.color];
    const usedMeters = roll.total_meters - roll.remaining_meters;
    const pctUsed = roll.total_meters > 0
        ? Math.round((usedMeters / roll.total_meters) * 100)
        : 0;

    return (
        <Dialog open={roll !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${config.dot}`} />
                        {formatFilmRollName(roll)}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2 flex-1 min-h-0 overflow-y-auto pr-1">
                    {/* Info grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div>
                            <p className="text-muted-foreground text-xs">Loja</p>
                            <p className="font-medium">{roll.store_name ?? `Loja ${roll.store_id}`}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-xs">Tipo</p>
                            <p className="font-medium">{roll.film_type_name}</p>
                        </div>
                        {roll.tonality && (
                            <div>
                                <p className="text-muted-foreground text-xs">Tonalidade</p>
                                <p className="font-medium">{roll.tonality}</p>
                            </div>
                        )}
                        <div>
                            <p className="text-muted-foreground text-xs">Recebimento</p>
                            <p className="font-medium">{formatDate(roll.receipt_date)}</p>
                        </div>
                        {(roll.supplier_name ?? roll.supplier) && (
                            <div>
                                <p className="text-muted-foreground text-xs">Fornecedor</p>
                                <p className="font-medium">{roll.supplier_name ?? roll.supplier}</p>
                            </div>
                        )}
                        {roll.nfe_number && (
                            <div>
                                <p className="text-muted-foreground text-xs">NFE / Nº Pedido</p>
                                <p className="font-medium">{roll.nfe_number}</p>
                            </div>
                        )}
                        <div>
                            <p className="text-muted-foreground text-xs">Status</p>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.badgeCls}`}>
                                {config.badge}
                            </span>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Uso: {formatMeters(usedMeters)}m de {formatMeters(roll.total_meters)}m</span>
                            <span>{pctUsed}% utilizado</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                            <div
                                className={`h-2.5 rounded-full transition-all ${config.bar}`}
                                style={{ width: `${pctUsed}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                                {formatMeters(roll.remaining_meters)}m restantes
                            </p>
                            {canEditInventory && roll.status !== 'esgotada' && (
                                <button
                                    type="button"
                                    onClick={handleOpenAdjust}
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                                    title="Ajustar metros restantes"
                                >
                                    <Pencil className="h-3 w-3" />
                                    Ajustar
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Adjust meters inline dialog */}
                    {adjustOpen && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Ajustar metros restantes
                            </p>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Metros restantes</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={roll.total_meters}
                                    step={0.5}
                                    value={adjustMeters}
                                    onChange={(e) => setAdjustMeters(Number(e.target.value))}
                                    className="h-8 text-sm"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Mínimo: 0m · Máximo: {formatMeters(roll.total_meters)}m
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Motivo <span className="font-normal text-destructive">(obrigatório)</span></Label>
                                <Input
                                    placeholder="Ex: conferência física 27/07"
                                    value={adjustNote}
                                    onChange={(e) => setAdjustNote(e.target.value)}
                                    className="h-8 text-sm"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    O ajuste vira um movimento no histórico da bobina.
                                </p>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setAdjustOpen(false)}
                                    disabled={adjustRollMutation.isPending}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleConfirmAdjust}
                                    disabled={adjustRollMutation.isPending || adjustMeters < 0 || adjustMeters > roll.total_meters || !adjustNote.trim()}
                                >
                                    {adjustRollMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
                                    Confirmar
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Consumptions table */}
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Histórico de Uso
                        </p>
                        {loadingConsumptions ? (
                            <div className="flex justify-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : !consumptions || consumptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-3">
                                Nenhum consumo registrado
                            </p>
                        ) : (
                            <div className="rounded-lg border border-border overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead className="bg-muted/50">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Modelo</th>
                                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Placa</th>
                                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Metros</th>
                                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Data</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {(consumptions as FilmConsumption[]).map((c) => (
                                            <tr key={c.id} className="hover:bg-muted/30">
                                                <td className="px-3 py-2">
                                                    {c.kind === 'ajuste'
                                                        ? `Ajuste de estoque${c.adjustment_reason ? ` — ${c.adjustment_reason}` : ''}`
                                                        : c.kind === 'reconciliacao'
                                                            ? 'Reconciliação de saldo'
                                                            : c.kind === 'retalho'
                                                                // Serviço que aproveitou sobra desta bobina — não debitou metros,
                                                                // mas fica registrado aqui para explicar por que aparece com 0m.
                                                                ? `Retalho — ${c.vehicle_model ?? '—'}`
                                                                : c.film_withdrawal_id != null
                                                                    ? `${c.meters_consumed < 0 ? 'Estorno de saída' : 'Saída avulsa'} — ${c.withdrawal_employee_name ?? '—'}`
                                                                    : (c.vehicle_model ?? '—')}
                                                </td>
                                                <td className="px-3 py-2">{c.film_withdrawal_id != null ? '—' : (c.plate ?? '—')}</td>
                                                <td className="px-3 py-2 text-right">
                                                    {c.kind === 'ajuste' || c.kind === 'reconciliacao'
                                                        ? `${-c.meters_consumed > 0 ? '+' : ''}${-c.meters_consumed}m`
                                                        : c.kind === 'retalho'
                                                            ? '0m (retalho)'
                                                            : `${c.meters_consumed}m`}
                                                </td>
                                                <td className="px-3 py-2 text-right text-muted-foreground">
                                                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <div className="border-t border-border pt-4 mt-2 flex flex-col gap-3 shrink-0">
                    {/* Ação principal do estado — destaque (o X do cabeçalho fecha o modal) */}
                    {roll.status === 'em_estoque' && canEditInventory && (
                        <Button
                            className="w-full bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-500 dark:hover:bg-amber-600"
                            onClick={() => openRoll.mutate(roll.id, { onSuccess: onClose })}
                            disabled={openRoll.isPending}
                        >
                            {openRoll.isPending
                                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                : <PackageOpen className="h-4 w-4 mr-2" />}
                            Colocar em uso
                        </Button>
                    )}
                    {roll.status === 'esgotada' && (
                        <Button
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white dark:bg-orange-500 dark:hover:bg-orange-600"
                            onClick={() => { onRestore(roll); onClose(); }}
                            disabled={isRestoring}
                        >
                            {isRestoring && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Restaurar Bobina
                        </Button>
                    )}

                    {/* Utilitários: Exportar + Transferir */}
                    <div
                        className={`grid gap-2 ${
                            roll.status !== 'esgotada' && onTransfer ? 'grid-cols-2' : 'grid-cols-1'
                        }`}
                    >
                        <Button
                            variant="outline"
                            onClick={handleExportRoll}
                            disabled={isExportingRoll}
                            className="border-green-600 text-green-700 hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-900/20"
                        >
                            {isExportingRoll
                                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                : <Download className="h-4 w-4 mr-2" />}
                            Exportar
                        </Button>
                        {roll.status !== 'esgotada' && onTransfer && (
                            <Button
                                variant="outline"
                                title="Transferir para outra loja"
                                className="border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                onClick={() => { onTransfer(roll); onClose(); }}
                            >
                                <ArrowLeftRight className="h-4 w-4 mr-2" />
                                Transferir
                            </Button>
                        )}
                    </div>

                    {/* Editar bobina (inline) */}
                    {editOpen && (
                        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Editar bobina
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                                    <Label className="text-xs">Tipo *</Label>
                                    <Select
                                        value={editFilmTypeId ? String(editFilmTypeId) : ''}
                                        onValueChange={(v) => { setEditFilmTypeId(Number(v)); setEditTonality(''); }}
                                    >
                                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                        <SelectContent>
                                            {editFilmTypes.map((ft) => (
                                                <SelectItem key={ft.id} value={String(ft.id)}>{ft.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                                    <Label className="text-xs">Tonalidade{editTonalities.length > 0 ? ' *' : ''}</Label>
                                    <Select
                                        value={editTonality || ''}
                                        onValueChange={setEditTonality}
                                        disabled={editTonalities.length === 0}
                                    >
                                        <SelectTrigger className="h-8 text-sm">
                                            <SelectValue placeholder={editTonalities.length === 0 ? 'N/A (PPF)' : 'Selecione...'} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {editTonalities.map((t) => (
                                                <SelectItem key={t} value={t}>{t}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Metros totais *</Label>
                                    <Input
                                        type="number"
                                        min={0.1}
                                        step={0.5}
                                        value={editTotalMeters}
                                        onChange={(e) => setEditTotalMeters(Number(e.target.value))}
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Recebimento</Label>
                                    <Input
                                        type="date"
                                        value={editReceipt}
                                        onChange={(e) => setEditReceipt(e.target.value)}
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5 col-span-2">
                                    <Label className="text-xs">Fornecedor</Label>
                                    <Select
                                        value={editSupplierId ? String(editSupplierId) : '__none__'}
                                        onValueChange={(v) => setEditSupplierId(v === '__none__' ? null : Number(v))}
                                    >
                                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">— Nenhum —</SelectItem>
                                            {editSuppliers.map((s) => (
                                                <SelectItem key={s.id} value={String(s.id)}>{s.company_name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Nota Fiscal</Label>
                                    <Input value={editNfe} onChange={(e) => setEditNfe(e.target.value)} className="h-8 text-sm" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Custo (R$)</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        min={0}
                                        value={editCost}
                                        onChange={(e) => setEditCost(e.target.value)}
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5 col-span-2">
                                    <Label className="text-xs">Lote</Label>
                                    <Input value={editLot} onChange={(e) => setEditLot(e.target.value)} className="h-8 text-sm" />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setEditOpen(false)} disabled={updateRollMutation.isPending}>
                                    Cancelar
                                </Button>
                                <Button
                                    size="sm"
                                    onClick={handleConfirmEdit}
                                    disabled={
                                        updateRollMutation.isPending ||
                                        !editFilmTypeId ||
                                        editTotalMeters <= 0 ||
                                        (editTonalities.length > 0 && !editTonality)
                                    }
                                >
                                    {updateRollMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
                                    Salvar
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Zona de finalização/exclusão, separada do resto */}
                    {(onDelete || roll.status !== 'esgotada' || canEditInventory) && (
                        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                            {onDelete ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-destructive text-destructive hover:bg-destructive/10"
                                    onClick={() => { onDelete(roll); onClose(); }}
                                >
                                    <Trash2 className="h-4 w-4 mr-1.5" />
                                    Excluir
                                </Button>
                            ) : (
                                <span />
                            )}
                            {canEditInventory ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleOpenEdit}
                                    className="border-primary/40 text-foreground hover:bg-primary/10"
                                >
                                    <Pencil className="h-4 w-4 mr-1.5" />
                                    Editar
                                </Button>
                            ) : (
                                <span />
                            )}
                            {roll.status !== 'esgotada' ? (
                                <Button
                                    variant="destructive"
                                    onClick={() => { onExhaust(roll); onClose(); }}
                                    disabled={isExhausting}
                                >
                                    {isExhausting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                    Confirmar Esgotamento
                                </Button>
                            ) : (
                                <span />
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─── MultiSelectFilter ────────────────────────────────────────────────────────

function MultiSelectFilter({
    options,
    value,
    onChange,
    maxSelect = 2,
}: {
    options: { value: string; label: string }[];
    value: string[];
    onChange: (v: string[]) => void;
    maxSelect?: number;
}) {
    function toggleOption(optValue: string) {
        if (value.includes(optValue)) {
            onChange(value.filter((v) => v !== optValue));
        } else if (value.length < maxSelect) {
            onChange([...value, optValue]);
        }
    }

    function triggerLabel(): string {
        if (value.length === 0) return 'Todos';
        if (value.length === 1) {
            return options.find((o) => o.value === value[0])?.label ?? value[0];
        }
        return `${value.length} selecionados`;
    }

    const hasSelection = value.length > 0;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex h-10 w-full sm:min-w-[140px] sm:w-auto items-center justify-between rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                        hasSelection
                            ? 'border-primary bg-primary/5 text-primary font-medium'
                            : 'border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] text-[#111111] dark:text-white hover:border-[#F5A800]'
                    }`}
                >
                    <span className="truncate">{triggerLabel()}</span>
                    <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-50 ml-2" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
                {options.map((opt) => {
                    const checked = value.includes(opt.value);
                    const disabled = !checked && value.length >= maxSelect;
                    return (
                        <DropdownMenuCheckboxItem
                            key={opt.value}
                            checked={checked}
                            onCheckedChange={() => toggleOption(opt.value)}
                            disabled={disabled}
                        >
                            {opt.label}
                        </DropdownMenuCheckboxItem>
                    );
                })}
                {hasSelection && (
                    <>
                        <DropdownMenuSeparator />
                        <button
                            type="button"
                            onClick={() => onChange([])}
                            className="w-full text-left text-xs text-muted-foreground px-2 py-1.5 hover:bg-muted rounded-sm transition-colors"
                        >
                            Limpar
                        </button>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// ─── InventoryPage ────────────────────────────────────────────────────────────

export default function InventoryPage() {
    const { toast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const { availableStores } = useStoreStore();
    const user = useAuthStore((s) => s.user);
    const canEditInventory = useCanEdit('inventory');

    // ── View (Estoque | Saídas) ──────────────────────────────────────────────
    const [view, setView] = useState<'estoque' | 'saidas'>('estoque');
    const [withdrawalOpen, setWithdrawalOpen] = useState(false);

    // ── Filters (client-side) ────────────────────────────────────────────────
    const [filterStoreId, setFilterStoreId] = useState<number | 'all'>('all');
    // Loja efetiva para alertas/etiquetas/forms — deriva do filtro "LOJA" local
    // ('all' = todas as lojas). Substitui a antiga loja global.
    const storeIdFilter = filterStoreId !== 'all' ? filterStoreId : undefined;
    const [filterFilmTypeId, setFilterFilmTypeId] = useState<number | 'all'>('all');
    const [filterTonalities, setFilterTonalities] = useState<string[]>([]);
    const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
    const [filterDept, setFilterDept] = useState<'all' | 'film' | 'security_film' | 'ppf'>('all');
    const [showExhausted, setShowExhausted] = useState(false);

    // ── Export state ─────────────────────────────────────────────────────────
    const [isExportingRolls, setIsExportingRolls] = useState(false);

    // ── Modal state ──────────────────────────────────────────────────────────
    const [detailRoll, setDetailRoll] = useState<FilmRoll | null>(null);
    const [entradaOpen, setEntradaOpen] = useState(false);
    const [criticalOpen, setCriticalOpen] = useState(false);
    const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
    const [pendingPayload, setPendingPayload] = useState<CreateFilmRollPayload | null>(null);
    const [exhaustingId, setExhaustingId] = useState<number | null>(null);
    const [restoringId, setRestoringId] = useState<number | null>(null);
    const [transferTarget, setTransferTarget] = useState<FilmRoll | null>(null);
    const [transferStoreId, setTransferStoreId] = useState<string>('');
    const [deleteRollTarget, setDeleteRollTarget] = useState<FilmRoll | null>(null);
    const [forecastTarget, setForecastTarget] = useState<{ filmTypeId: number; storeId: number; filmTypeName: string } | null>(null);
    const criticalShownRef = useRef(false);
    const deepLinkHandledRef = useRef<number | null>(null);

    // ── Entrada form state ───────────────────────────────────────────────────
    const [entradaDept, setEntradaDept] = useState<'film' | 'ppf' | 'security_film'>('film');
    const [form, setForm] = useState<CreateFilmRollPayload>({
        store_id: storeIdFilter ?? (user?.store_id ?? 0),
        film_type_id: 0,
        tonality: '',
        supplier: '',
        nfe_number: '',
        total_meters: 0,
        receipt_date: new Date().toISOString().split('T')[0],
        cost: undefined,
        lot_number: '',
        supplier_id: undefined,
    });

    // ── Queries ───────────────────────────────────────────────────────────────

    // All film types for lookup map and filter dropdown.
    // Dado quase estático (tipos de película) → cache longo (60 min) para não
    // re-buscar 200 itens a cada reabertura da tela (reduz a rajada no backend).
    // queryKey ['film-types','all',200] (mesma do RollDetailModal): (a) deduplica
    // a busca e (b) é invalidada pelo CRUD de tipos via invalidateQueries(['film-types'])
    // (match por prefixo) — a key antiga ['film-types-all'] nunca era invalidada.
    const { data: filmTypesAll } = useQuery({
        queryKey: ['film-types', 'all', 200],
        queryFn: () => inventoryService.listFilmTypes({ limit: 200 }),
        staleTime: 1000 * 60 * 60,
    });

    // Film types for entrada modal filtered by entradaDept
    const { data: entradaFilmTypesData } = useQuery({
        queryKey: ['film-types', entradaDept],
        queryFn: () => inventoryService.listFilmTypes({ department: entradaDept, limit: 100 }),
        enabled: entradaOpen,
        staleTime: 1000 * 60 * 5,
    });

    // Busca todas as bobinas sem filtro de loja — filtragem feita 100% no cliente
    // para garantir que bobinas criadas em qualquer loja apareçam imediatamente.
    // staleTime de 30s evita re-buscar as ~500 bobinas a cada navegação/refocus;
    // toda mutação de estoque invalida ['inventory-rolls'], então a lista continua
    // fresca após ações (a imediatez no mount é preservada).
    const { data: rollsData, isLoading, isError, refetch } = useQuery({
        queryKey: ['inventory-rolls'],
        queryFn: () => inventoryService.listRolls({ limit: 500 }),
        staleTime: 1000 * 30,
    });

    const selectedStoreIdForCritical = storeIdFilter;
    const { data: criticalRolls } = useQuery({
        queryKey: ['inventory-critical', selectedStoreIdForCritical],
        queryFn: () => inventoryService.listCriticalRolls(selectedStoreIdForCritical),
        enabled: true,
        staleTime: 1000 * 30,
    });

    // Este uso de fornecedores alimenta o select do modal de Entrada → carrega sob
    // demanda (não no mount), tirando uma requisição da rajada de abertura da tela.
    // (O formulário de edição do RollDetailModal usa outra query, gateada em editOpen.)
    const { data: suppliersData } = useSuppliers(undefined, { enabled: entradaOpen });

    // Lojas quase nunca mudam. Alinha ao cache do hook useStores (1h) — a mesma
    // queryKey ['stores'] era encurtada para 5 min aqui, forçando refetches.
    const { data: storesForSharing = [] } = useQuery({
        queryKey: ['stores'],
        queryFn: () => storesService.list(),
        staleTime: 1000 * 60 * 60,
    });

    // Auto-open critical modal once on mount
    useEffect(() => {
        if (!criticalShownRef.current && criticalRolls && criticalRolls.length > 0) {
            criticalShownRef.current = true;
            setTimeout(() => setCriticalOpen(true), 300);
        }
    }, [criticalRolls]);

    // Deep-link vindo da notificação (?roll=<id>) — abre o modal de detalhes da bobina.
    // Espera a lista principal carregar; se a bobina não estiver nela (ex.: fora do
    // limite de 500 itens), tenta um fetch dedicado via include_roll_ids (que ignora
    // os filtros de status/tipo, então acha a bobina mesmo esgotada). Se ainda assim
    // não achar, avisa por toast e permanece na tela sem quebrar.
    useEffect(() => {
        const rollParam = searchParams.get('roll');
        if (!rollParam) return;
        if (isLoading) return;

        const rollId = Number(rollParam);
        if (deepLinkHandledRef.current === rollId) return;

        if (!Number.isInteger(rollId) || rollId <= 0) {
            deepLinkHandledRef.current = rollId;
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('roll');
                return next;
            }, { replace: true });
            return;
        }

        const clearRollParam = () => {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('roll');
                return next;
            }, { replace: true });
        };

        const found = rollsData?.items.find((r) => r.id === rollId);
        if (found) {
            deepLinkHandledRef.current = rollId;
            setDetailRoll(found);
            clearRollParam();
            return;
        }

        deepLinkHandledRef.current = rollId;
        (async () => {
            try {
                const fallback = await inventoryService.listRolls({ include_roll_ids: [rollId], limit: 1 });
                const fallbackRoll = fallback.items.find((r) => r.id === rollId);
                if (fallbackRoll) {
                    setDetailRoll(fallbackRoll);
                } else {
                    toast({ title: 'Bobina não encontrada na lista atual', variant: 'destructive' });
                }
            } catch {
                toast({ title: 'Bobina não encontrada na lista atual', variant: 'destructive' });
            } finally {
                clearRollParam();
            }
        })();
    }, [searchParams, rollsData, isLoading, setSearchParams, toast]);

    // ── Mutations ─────────────────────────────────────────────────────────────

    const createRoll = useMutation({
        mutationFn: ({ payload, force }: { payload: CreateFilmRollPayload; force: boolean }) =>
            inventoryService.createRoll(payload, force),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            setEntradaOpen(false);
            setPendingPayload(null);
            setEntradaDept('film');
            setForm({
                store_id: storeIdFilter ?? (user?.store_id ?? 0),
                film_type_id: 0,
                tonality: '',
                supplier: '',
                nfe_number: '',
                total_meters: 0,
                receipt_date: new Date().toISOString().split('T')[0],
                cost: undefined,
                lot_number: '',
                supplier_id: undefined,
            });
            toast({ title: 'Bobina registrada com sucesso' });
        },
        onError: (err: unknown) => {
            const status = (err as { response?: { status: number } })?.response?.status;
            if (status === 409) {
                setPendingPayload(form);
                setForceConfirmOpen(true);
            } else {
                toast({ title: 'Erro ao registrar bobina', variant: 'destructive' });
            }
        },
    });

    const exhaustRoll = useMutation({
        mutationFn: (id: number) => inventoryService.exhaustRoll(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            setExhaustingId(null);
            toast({ title: 'Bobina marcada como esgotada' });
        },
    });

    const restoreRoll = useMutation({
        mutationFn: (id: number) => inventoryService.restoreRoll(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            setRestoringId(null);
            toast({ title: 'Bobina restaurada com sucesso' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao restaurar bobina' });
        },
    });

    const transferRollMutation = useMutation({
        mutationFn: ({ rollId, storeId }: { rollId: number; storeId: number }) =>
            inventoryService.transferRoll(rollId, storeId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            setTransferTarget(null);
            setTransferStoreId('');
            setDetailRoll(null);
            toast({ title: 'Bobina transferida com sucesso' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao transferir bobina' });
        },
    });

    const deleteRollMutation = useMutation({
        mutationFn: (id: number) => inventoryService.deleteRoll(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            setDeleteRollTarget(null);
            setDetailRoll(null);
            toast({ title: 'Bobina excluída com sucesso' });
        },
        onError: (err: unknown) => {
            setDeleteRollTarget(null);
            toast({
                title: 'Não foi possível excluir',
                description: getApiErrorMessage(err as Error, 'Erro ao excluir bobina.'),
                variant: 'destructive',
            });
        },
    });

    // ── Handlers ──────────────────────────────────────────────────────────────

    const handleSubmitEntrada = () => {
        if (!form.store_id || !form.film_type_id || !form.total_meters) {
            toast({ title: 'Preencha todos os campos', variant: 'destructive' });
            return;
        }
        if ((entradaDept === 'film' || entradaDept === 'security_film') && !form.tonality) {
            toast({ title: 'Informe a tonalidade', variant: 'destructive' });
            return;
        }
        const payload: CreateFilmRollPayload = {
            ...form,
            tonality: (entradaDept === 'film' || entradaDept === 'security_film') ? form.tonality : undefined,
            supplier: undefined,
            supplier_id: form.supplier_id ?? undefined,
            nfe_number: form.nfe_number?.trim() || undefined,
            cost: form.cost ?? undefined,
            lot_number: form.lot_number?.trim() || undefined,
        };
        createRoll.mutate({ payload, force: false });
    };

    const handleForceConfirm = () => {
        if (pendingPayload) {
            createRoll.mutate({ payload: pendingPayload, force: true });
        }
        setForceConfirmOpen(false);
    };

    const handleExportRolls = async () => {
        setIsExportingRolls(true);
        try {
            const blob = await inventoryService.exportRolls({
                store_id: filterStoreId !== 'all' ? filterStoreId : undefined,
                film_type_id: filterFilmTypeId !== 'all' ? filterFilmTypeId : undefined,
                department: filterDept !== 'all' ? filterDept : undefined,
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `estoque_pelicula_${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setIsExportingRolls(false);
        }
    };

    const handleExhaust = (roll: FilmRoll) => {
        setExhaustingId(roll.id);
        exhaustRoll.mutate(roll.id);
    };

    const handleRestore = (roll: FilmRoll) => {
        setRestoringId(roll.id);
        restoreRoll.mutate(roll.id);
    };

    // ── Derived data ──────────────────────────────────────────────────────────

    const filmTypesMap = useMemo(() => {
        const map = new Map<number, FilmType>();
        for (const ft of filmTypesAll?.items ?? []) {
            map.set(ft.id, ft);
        }
        return map;
    }, [filmTypesAll]);

    const handleForecastClick = (filmTypeId: number, storeId: number) => {
        const filmType = filmTypesMap.get(filmTypeId);
        setForecastTarget({
            filmTypeId,
            storeId,
            filmTypeName: filmType?.name ?? `Tipo ${filmTypeId}`,
        });
    };

    // Compute shared-inventory display groups: stores that share inventory appear
    // as a single merged card with a combined label (e.g. "Loja A + Loja B").
    const inventoryGroupDefs = useMemo(
        () => computeInventoryGroups(storesForSharing),
        [storesForSharing]
    );

    // Expand a single store filter to include all stores in its shared-inventory group
    const effectiveStoreIds = useMemo((): number[] | 'all' => {
        if (filterStoreId === 'all') return 'all';
        const group = inventoryGroupDefs.find((g) => g.storeIds.includes(filterStoreId));
        return group ? group.storeIds : [filterStoreId];
    }, [filterStoreId, inventoryGroupDefs]);

    // Apply client-side filters then group
    const filteredRolls = useMemo(() => {
        let items = rollsData?.items ?? [];

        if (effectiveStoreIds !== 'all') {
            items = items.filter((r) => (effectiveStoreIds as number[]).includes(r.store_id));
        }
        if (filterFilmTypeId !== 'all') {
            items = items.filter((r) => r.film_type_id === filterFilmTypeId);
        }
        if (filterTonalities.length > 0) {
            items = items.filter((r) => filterTonalities.includes(r.tonality ?? ''));
        }
        if (!showExhausted) {
            items = items.filter((r) => r.status !== 'esgotada');
        }
        if (filterStatuses.length > 0) {
            items = items.filter((r) => filterStatuses.includes(r.status));
        }
        if (filterDept !== 'all') {
            const typeIds = new Set(
                (filmTypesAll?.items ?? [])
                    .filter((ft) => ft.department === filterDept)
                    .map((ft) => ft.id)
            );
            items = items.filter((r) => typeIds.has(r.film_type_id));
        }

        return items;
    }, [rollsData, effectiveStoreIds, filterFilmTypeId, filterTonalities, showExhausted, filterStatuses, filterDept, filmTypesAll]);


    const storeGroups = useMemo(
        () => groupByStore(filteredRolls, filmTypesMap),
        [filteredRolls, filmTypesMap]
    );

    const mergedStoreGroups = useMemo(
        () => mergeStoreGroupsForDisplay(storeGroups, inventoryGroupDefs),
        [storeGroups, inventoryGroupDefs]
    );

    // Distinct tonalities for filter dropdown (film only — PPF has no tonality)
    const distinctTonalities = useMemo(() => {
        const seen = new Set<string>();
        const result: { value: string; label: string }[] = [];
        for (const roll of rollsData?.items ?? []) {
            if (!roll.tonality) continue;
            if (!seen.has(roll.tonality)) {
                seen.add(roll.tonality);
                result.push({ value: roll.tonality, label: roll.tonality });
            }
        }
        return result.sort((a, b) => a.label.localeCompare(b.label));
    }, [rollsData]);

    const filmTypesForDropdown = filmTypesAll?.items ?? [];
    const entradaFilmTypes = entradaFilmTypesData?.items ?? [];
    const critical = criticalRolls ?? [];
    const totalRollsShown = filteredRolls.length;

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            <div className="space-y-3">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}>
                            Controle de Estoque
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">Bobinas de película e PPF organizadas por loja</p>
                    </div>
                </div>
                {critical.length > 0 && (
                    <div className="sm:flex-1 sm:px-4">
                        <button
                            onClick={() => setCriticalOpen(true)}
                            className="w-full flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                        >
                            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
                            {critical.length} bobina{critical.length > 1 ? 's' : ''} crítica{critical.length > 1 ? 's' : ''}
                        </button>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:shrink-0">
                    {view === 'estoque' && (
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={handleExportRolls}
                            disabled={isExportingRolls}
                        >
                            {isExportingRolls
                                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                : <Download className="h-4 w-4 mr-2" />
                            }
                            Exportar Excel
                        </Button>
                    )}
                    {canEditInventory && (
                        <Button
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => setWithdrawalOpen(true)}
                        >
                            <Scissors className="h-4 w-4 mr-2" />
                            Registrar Saída
                        </Button>
                    )}
                    <Button
                        className="w-full sm:w-auto"
                        onClick={() => {
                        setForm(f => ({ ...f, store_id: storeIdFilter ?? (user?.store_id ?? 0) }));
                        setEntradaOpen(true);
                    }}>
                        <Plus className="h-4 w-4 mr-2" />
                        Entrada de Bobina
                    </Button>
                </div>
            </div>

            {/* View toggle: Estoque | Saídas */}
            <div className="flex gap-1.5">
                {([
                    { key: 'estoque', label: 'Estoque', icon: Package },
                    { key: 'saidas', label: 'Saídas', icon: Scissors },
                ] as const).map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        onClick={() => setView(key)}
                        className={`flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium border transition-colors ${
                            view === key
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'border-border hover:bg-muted'
                        }`}
                    >
                        <Icon className="h-4 w-4" />
                        {label}
                    </button>
                ))}
            </div>

            {/* Filters */}
            {view === 'estoque' && (
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                <div className="flex flex-wrap gap-4 items-end">
                    {/* Dept toggle */}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Departamento</span>
                        <div className="flex gap-1.5">
                            {(['all', 'film', 'security_film', 'ppf'] as const).map((dept) => (
                                <button
                                    key={dept}
                                    onClick={() => setFilterDept(dept)}
                                    className={`px-3 h-10 rounded-md text-xs font-medium border transition-colors ${
                                        filterDept === dept
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'border-border hover:bg-muted'
                                    }`}
                                >
                                    {dept === 'all' ? 'Todos' : dept === 'film' ? 'Película' : dept === 'security_film' ? 'Pel. Segurança' : 'PPF'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Store filter (only if multiple stores) */}
                    {availableStores.length > 1 && (
                        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Loja</span>
                            <Select value={filterStoreId.toString()} onValueChange={(v) => setFilterStoreId(v === 'all' ? 'all' : Number(v))}>
                                <SelectTrigger className="w-full sm:w-40">
                                    <SelectValue placeholder="Loja" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as lojas</SelectItem>
                                    {availableStores.map((s) => (
                                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5 w-full sm:w-auto">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tipo</span>
                        <Select value={filterFilmTypeId.toString()} onValueChange={(v) => setFilterFilmTypeId(v === 'all' ? 'all' : Number(v))}>
                            <SelectTrigger className="w-full sm:w-40">
                                <SelectValue placeholder="Tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os tipos</SelectItem>
                                {filmTypesForDropdown.map((ft) => (
                                    <SelectItem key={ft.id} value={ft.id.toString()}>{ft.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {filterDept !== 'ppf' && distinctTonalities.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tonalidade</span>
                            <MultiSelectFilter
                                options={distinctTonalities}
                                value={filterTonalities}
                                onChange={setFilterTonalities}
                            />
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</span>
                        <MultiSelectFilter
                            options={[
                                { value: 'em_estoque', label: 'Em Estoque' },
                                { value: 'em_uso', label: 'Em Uso' },
                            ]}
                            value={filterStatuses}
                            onChange={setFilterStatuses}
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Esgotadas</span>
                        <button
                            type="button"
                            onClick={() => setShowExhausted((v) => !v)}
                            className={`flex h-10 items-center gap-2 px-3 rounded-md border text-sm transition-colors whitespace-nowrap ${
                                showExhausted
                                    ? 'border-primary bg-primary/5 text-primary font-medium'
                                    : 'border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] text-[#111111] dark:text-white hover:border-[#F5A800]'
                            }`}
                        >
                            {showExhausted
                                ? <Eye className="h-4 w-4 flex-shrink-0" />
                                : <EyeOff className="h-4 w-4 flex-shrink-0" />
                            }
                            {showExhausted ? 'Visíveis' : 'Ocultas'}
                        </button>
                    </div>
                </div>
            </div>
            )}
            </div>

            {/* Saídas avulsas */}
            {view === 'saidas' && (
                <WithdrawalsSection filmTypes={filmTypesForDropdown} />
            )}

            {/* Legend */}
            {view === 'estoque' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                {(Object.entries(COLOR_CONFIG) as [FilmRollColor, typeof COLOR_CONFIG[FilmRollColor]][]).map(([color, cfg]) => (
                    <span key={color} className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        {cfg.badge}
                    </span>
                ))}
            </div>
            )}

            {/* Main content */}
            {view !== 'estoque' ? null : isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 space-y-3">
                            <Skeleton className="h-5 w-1/2 bg-gray-200 dark:bg-zinc-800 animate-pulse rounded" />
                            <Skeleton className="h-4 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse rounded" />
                            <Skeleton className="h-4 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse rounded" />
                        </div>
                    ))}
                </div>
            ) : isError ? (
                // Erro não pode parecer "estoque zerado" — controla película física
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <p className="flex items-center gap-2 text-red-500 text-sm font-medium">
                        <AlertCircle className="w-4 h-4" />
                        Erro ao carregar as bobinas do estoque.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                        Tentar novamente
                    </Button>
                </div>
            ) : mergedStoreGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                    <Package className="h-12 w-12 opacity-30" />
                    <p className="text-sm">Nenhuma bobina encontrada</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {mergedStoreGroups.map((g) => (
                            <StoreCard
                                key={g.store_id}
                                group={g}
                                displayName={g.displayName}
                                onDetailClick={setDetailRoll}
                                onForecastClick={handleForecastClick}
                            />
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground text-right">
                        Exibindo {mergedStoreGroups.length} grupo{mergedStoreGroups.length !== 1 ? 's' : ''} · {totalRollsShown} bobina{totalRollsShown !== 1 ? 's' : ''}
                    </p>
                </>
            )}

            {/* Modal de Saída Avulsa */}
            <WithdrawalModal
                open={withdrawalOpen}
                onClose={() => setWithdrawalOpen(false)}
                rolls={rollsData?.items ?? []}
                filmTypes={filmTypesForDropdown}
                defaultStoreId={storeIdFilter ?? null}
            />

            {/* Forecast Modal */}
            <ForecastModal
                filmTypeId={forecastTarget?.filmTypeId ?? null}
                storeId={forecastTarget?.storeId ?? null}
                filmTypeName={forecastTarget?.filmTypeName ?? ''}
                onClose={() => setForecastTarget(null)}
            />

            {/* Roll Detail Modal — usa a versão FRESCA da lista (invalidada pelo ajuste)
                para a barra de saldo refletir na hora; cai no snapshot se não achar. */}
            <RollDetailModal
                roll={detailRoll ? (rollsData?.items?.find((r) => r.id === detailRoll.id) ?? detailRoll) : null}
                onClose={() => setDetailRoll(null)}
                onExhaust={handleExhaust}
                isExhausting={detailRoll !== null && exhaustingId === detailRoll.id && exhaustRoll.isPending}
                onRestore={handleRestore}
                isRestoring={detailRoll !== null && restoringId === detailRoll.id && restoreRoll.isPending}
                onTransfer={(roll) => { setTransferTarget(roll); setTransferStoreId(''); }}
                onDelete={(roll) => setDeleteRollTarget(roll)}
            />

            {/* Modal de Entrada */}
            <Dialog open={entradaOpen} onOpenChange={(o) => {
                if (!o) {
                    setEntradaDept('film');
                    setForm({
                        store_id: storeIdFilter ?? (user?.store_id ?? 0),
                        film_type_id: 0,
                        tonality: '',
                        supplier: '',
                        nfe_number: '',
                        total_meters: 0,
                        receipt_date: new Date().toISOString().split('T')[0],
                        cost: undefined,
                        lot_number: '',
                        supplier_id: undefined,
                    });
                }
                setEntradaOpen(o);
            }}>
                <DialogContent className="flex flex-col max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle>Entrada de Bobina</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0 pr-1">
                        {/* Toggle Película / PPF */}
                        <div className="space-y-1.5">
                            <Label>Tipo de Estoque</Label>
                            <div className="flex gap-2">
                                {(['film', 'security_film', 'ppf'] as const).map((d) => (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={() => {
                                            setEntradaDept(d);
                                            setForm((f) => ({ ...f, film_type_id: 0, tonality: '' }));
                                        }}
                                        className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                                            entradaDept === d
                                                ? 'bg-primary text-primary-foreground border-primary'
                                                : 'border-border hover:bg-muted'
                                        }`}
                                    >
                                        {d === 'film' ? 'Película' : d === 'security_film' ? 'Pel. Segurança' : 'PPF'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {availableStores.length > 1 && (
                            <div className="space-y-1.5">
                                <Label>Loja</Label>
                                <Select
                                    value={form.store_id.toString()}
                                    onValueChange={(v) => setForm((f) => ({ ...f, store_id: Number(v) }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione a loja" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableStores.map((s) => (
                                            <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label>{entradaDept === 'ppf' ? 'Tipo de PPF' : 'Tipo de Película'}</Label>
                            <Select
                                value={form.film_type_id ? form.film_type_id.toString() : ''}
                                onValueChange={(v) => setForm((f) => ({ ...f, film_type_id: Number(v) }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione o tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    {entradaFilmTypes.filter((ft) => ft.is_active).map((ft) => (
                                        <SelectItem key={ft.id} value={ft.id.toString()}>{ft.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {(entradaDept === 'film' || entradaDept === 'security_film') && (
                            <div className="space-y-1.5">
                                <Label>Tonalidade</Label>
                                <Select
                                    value={form.tonality ?? ''}
                                    onValueChange={(v) => setForm((f) => ({ ...f, tonality: v }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione a tonalidade" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {FILM_TONALITY_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label>Fornecedor <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                            {suppliersData && suppliersData.items.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-2">Nenhum fornecedor cadastrado</p>
                            ) : (
                                <Select
                                    value={form.supplier_id != null ? form.supplier_id.toString() : '__none__'}
                                    onValueChange={(v) =>
                                        setForm((f) => ({
                                            ...f,
                                            supplier_id: v === '__none__' ? undefined : Number(v),
                                        }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione o fornecedor" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">Sem fornecedor</SelectItem>
                                        {(suppliersData?.items ?? []).map((s) => (
                                            <SelectItem key={s.id} value={s.id.toString()}>
                                                {s.company_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label>NFE / Nº Pedido <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                            <Input
                                placeholder="Ex: NF-001234 ou PED-5678"
                                value={form.nfe_number ?? ''}
                                onChange={(e) => setForm((f) => ({ ...f, nfe_number: e.target.value }))}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>Metragem total (m)</Label>
                            <Input
                                type="number"
                                min={1}
                                placeholder="Ex: 15"
                                value={form.total_meters || ''}
                                onChange={(e) => setForm((f) => ({ ...f, total_meters: Number(e.target.value) }))}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Data de recebimento</Label>
                            <Input
                                type="date"
                                value={form.receipt_date}
                                onChange={(e) => setForm((f) => ({ ...f, receipt_date: e.target.value }))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>Custo (R$) <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                                <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    placeholder="0,00"
                                    value={form.cost ?? ''}
                                    onChange={(e) => setForm((f) => ({
                                        ...f,
                                        cost: e.target.value === '' ? undefined : Number(e.target.value),
                                    }))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Lote <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                                <Input
                                    placeholder="Número do lote"
                                    value={form.lot_number ?? ''}
                                    onChange={(e) => setForm((f) => ({ ...f, lot_number: e.target.value }))}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEntradaOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSubmitEntrada} disabled={createRoll.isPending}>
                            {createRoll.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Registrar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal de alerta de estoque */}
            <Dialog open={criticalOpen} onOpenChange={setCriticalOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-5 w-5" />
                            Alerta de Estoque
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 py-2 max-h-96 overflow-y-auto pr-1">
                        <p className="text-sm text-muted-foreground mb-3">
                            As bobinas abaixo estão com metragem baixa. Bobinas em vermelho precisam de confirmação de esgotamento.
                        </p>
                        {critical.map((roll) => {
                            const isRed = roll.color === 'red';
                            return (
                                <div
                                    key={roll.id}
                                    className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                                        isRed
                                            ? 'border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800'
                                            : 'border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800'
                                    }`}
                                >
                                    <div className="min-w-0 mr-3">
                                        <p className={`text-sm font-medium truncate ${isRed ? 'text-red-800 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-300'}`}>
                                            {formatFilmRollName(roll)}
                                        </p>
                                        <p className={`text-xs ${isRed ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'}`}>
                                            {roll.remaining_meters.toFixed(1)}m restantes
                                            {roll.store_name && (
                                                <span className="ml-1.5 font-medium">· {roll.store_name}</span>
                                            )}
                                        </p>
                                    </div>
                                    {isRed && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="shrink-0 border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/40 text-xs"
                                            onClick={() => {
                                                handleExhaust(roll);
                                                if (critical.filter((r) => r.color === 'red').length <= 1) setCriticalOpen(false);
                                            }}
                                            disabled={exhaustingId === roll.id && exhaustRoll.isPending}
                                        >
                                            Confirmar Esgotamento
                                        </Button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCriticalOpen(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal de Transferência de Bobina */}
            <Dialog
                open={!!transferTarget}
                onOpenChange={(v) => {
                    if (!v) {
                        setTransferTarget(null);
                        setTransferStoreId('');
                    }
                }}
            >
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Transferir Bobina</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Selecione a loja de destino para a bobina <strong>{transferTarget ? formatFilmRollName(transferTarget) : ''}</strong>.
                    </p>
                    {transferTarget && transferTarget.status !== 'em_estoque' && (
                        <p className="text-xs rounded-lg px-3 py-2 bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700/40 dark:text-amber-400">
                            Esta bobina já foi usada: os <strong>{transferTarget.remaining_meters}m restantes</strong> passam
                            a contar no estoque da loja de destino, e o histórico de consumo vai junto.
                        </p>
                    )}
                    <Select value={transferStoreId} onValueChange={setTransferStoreId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Selecionar loja..." />
                        </SelectTrigger>
                        <SelectContent>
                            {availableStores
                                .filter((s) => s.id !== transferTarget?.store_id)
                                .map((s) => (
                                    <SelectItem key={s.id} value={s.id.toString()}>
                                        {s.name}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setTransferTarget(null);
                                setTransferStoreId('');
                            }}
                        >
                            Cancelar
                        </Button>
                        <Button
                            disabled={!transferStoreId || transferRollMutation.isPending}
                            onClick={() =>
                                transferTarget &&
                                transferRollMutation.mutate({
                                    rollId: transferTarget.id,
                                    storeId: Number(transferStoreId),
                                })
                            }
                        >
                            {transferRollMutation.isPending && (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            )}
                            Confirmar Transferência
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Confirmação de exclusão de bobina */}
            <AlertDialog open={!!deleteRollTarget} onOpenChange={(o) => { if (!o) setDeleteRollTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir bobina?</AlertDialogTitle>
                        <AlertDialogDescription>
                            <strong>{deleteRollTarget ? formatFilmRollName(deleteRollTarget) : ''}</strong> será excluída permanentemente. Esta ação não pode ser desfeita.
                            {'\n'}Não é possível excluir bobinas que já foram utilizadas em ordens de serviço.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => deleteRollTarget && deleteRollMutation.mutate(deleteRollTarget.id)}
                            disabled={deleteRollMutation.isPending}
                        >
                            {deleteRollMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Excluir permanentemente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Confirmação de força (409) */}
            <AlertDialog open={forceConfirmOpen} onOpenChange={setForceConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Bobinas críticas pendentes</AlertDialogTitle>
                        <AlertDialogDescription>
                            Existem bobinas do mesmo tipo em estado crítico. Deseja registrar a nova entrada mesmo assim?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleForceConfirm}>Confirmar e Continuar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
