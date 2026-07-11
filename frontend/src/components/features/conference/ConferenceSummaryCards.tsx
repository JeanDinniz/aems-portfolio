import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { DEPARTMENTS_MAP } from '@/constants/service-orders';
import { DEPARTMENT_COLORS, DEPARTMENT_FALLBACK_COLOR } from '@/constants/departments';
import type { ConferenceSummaryByStoreItem } from '@/hooks/useConferenceSummaryByStore';

const DEPT_PROGRESS_COLORS: Record<string, string> = {
    film:     '[&>[data-radix-progress-indicator]]:bg-purple-500',
    ppf:      '[&>[data-radix-progress-indicator]]:bg-blue-500',
    vn:       '[&>[data-radix-progress-indicator]]:bg-green-500',
    vd:       '[&>[data-radix-progress-indicator]]:bg-teal-500',
    vu:       '[&>[data-radix-progress-indicator]]:bg-yellow-500',
    bodywork: '[&>[data-radix-progress-indicator]]:bg-orange-500',
    workshop: '[&>[data-radix-progress-indicator]]:bg-zinc-500',
};

export interface ConferenceSummaryCardsProps {
    summary: Array<{
        department: string;
        total: number;
        verified: number;
        waiting: number;
        wrong: number;
        cancelled: number;
        percent_verified: number;
    }>;
    isLoading: boolean;
    onFilterClick?: (department: string, filterType: 'verified' | 'waiting' | 'wrong' | 'all' | 'cancelled') => void;
    storeSummary?: ConferenceSummaryByStoreItem[];
    storeSummaryLoading?: boolean;
}

// ─── Card de resumo reutilizável ──────────────────────────────────────────────
function SummaryCard({
    label,
    badgeClassName,
    pct,
    progressColorClass,
    verified,
    waiting,
    wrong,
    cancelled,
    total,
    storeVariant = false,
    onVerifiedClick,
    onWaitingClick,
    onWrongClick,
    onCancelledClick,
    onTotalClick,
}: {
    label: string;
    badgeClassName?: string;
    pct: number;
    progressColorClass: string;
    verified: number;
    waiting: number;
    wrong: number;
    cancelled: number;
    total: number;
    storeVariant?: boolean;
    onVerifiedClick?: () => void;
    onWaitingClick?: () => void;
    onWrongClick?: () => void;
    onCancelledClick?: () => void;
    onTotalClick?: () => void;
}) {
    const cancelledButton = cancelled > 0 && (
        <button
            type="button"
            onClick={onCancelledClick}
            className={`flex items-center gap-1.5 text-left ${onCancelledClick ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
        >
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shrink-0" />
            <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                <span className="font-semibold text-zinc-500 dark:text-zinc-400">{cancelled}</span> cancelada{cancelled !== 1 ? 's' : ''}
            </span>
        </button>
    );

    return (
        <div className="flex-1 min-w-[200px] max-w-[260px] shrink-0 bg-[#FAFAFA] dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#333333] rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                {badgeClassName ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${badgeClassName}`}>
                        {label}
                    </span>
                ) : (
                    <span className="text-xs font-semibold text-[#111111] dark:text-white truncate">{label}</span>
                )}
                <span className="text-xs font-bold text-[#111111] dark:text-white tabular-nums shrink-0">
                    {pct}%
                </span>
            </div>

            <Progress
                value={pct}
                className={`h-2 bg-[#E8E8E8] dark:bg-[#3A3A3A] rounded-full ${progressColorClass}`}
            />

            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <button
                    type="button"
                    onClick={onVerifiedClick}
                    className={`flex items-center gap-1.5 text-left ${onVerifiedClick ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                    <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                        <span className="font-semibold text-green-600 dark:text-green-400">{verified}</span> verificadas
                    </span>
                </button>
                <button
                    type="button"
                    onClick={onWaitingClick}
                    className={`flex items-center gap-1.5 text-left ${onWaitingClick ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                        <span className="font-semibold text-amber-500 dark:text-amber-400">{waiting}</span> aguardando
                    </span>
                </button>
                {wrong > 0 && (
                    <button
                        type="button"
                        onClick={onWrongClick}
                        className={`flex items-center gap-1.5 text-left ${storeVariant ? 'col-span-2' : ''} ${onWrongClick ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                    >
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                        <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                            <span className="font-semibold text-red-500 dark:text-red-400">{wrong}</span> erro
                        </span>
                    </button>
                )}
                {!storeVariant && cancelledButton}
                <button
                    type="button"
                    onClick={onTotalClick}
                    className={`flex items-center gap-1.5 text-left ${storeVariant && cancelled > 0 ? '' : 'col-span-2'} ${onTotalClick ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${storeVariant ? 'bg-blue-500' : 'bg-[#D1D1D1] dark:bg-zinc-600'}`} />
                    <span className="text-xs text-[#666666] dark:text-zinc-400 truncate">
                        <span className={`font-semibold ${storeVariant ? 'text-blue-600 dark:text-blue-400' : 'text-[#111111] dark:text-white'}`}>{total}</span> total
                    </span>
                </button>
                {storeVariant && cancelledButton}
            </div>
        </div>
    );
}

// ─── Skeleton de card ─────────────────────────────────────────────────────────
function CardSkeleton() {
    return (
        <div className="flex-1 min-w-[200px] max-w-[260px] shrink-0 bg-[#FAFAFA] dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#333333] rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-20 rounded" />
                <Skeleton className="h-4 w-8 rounded" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-full rounded" />
            </div>
        </div>
    );
}

export function ConferenceSummaryCards({
    summary,
    isLoading,
    onFilterClick,
    storeSummary = [],
    storeSummaryLoading = false,
}: ConferenceSummaryCardsProps) {
    const [expanded, setExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<'dept' | 'store'>('dept');

    const hasData = isLoading || (summary && summary.length > 0) || storeSummaryLoading || storeSummary.length > 0;
    if (!hasData) return null;

    return (
        <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
            {/* Header com seletor de abas + toggle de expansão */}
            <div className="flex items-center justify-between px-4 py-2">
                {/* Abas */}
                <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold text-[#111111] dark:text-white mr-2">Resumo das O.S.</span>
                    <div className="flex items-center rounded-lg border border-[#D1D1D1] dark:border-[#333333] overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setActiveTab('dept')}
                            className={`px-3 py-1 text-xs font-medium transition-colors ${
                                activeTab === 'dept'
                                    ? 'bg-[#F5A800] text-[#1A1A1A]'
                                    : 'bg-transparent text-[#666666] dark:text-zinc-400 hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A]'
                            }`}
                        >
                            Por departamento
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('store')}
                            className={`px-3 py-1 text-xs font-medium transition-colors ${
                                activeTab === 'store'
                                    ? 'bg-[#F5A800] text-[#1A1A1A]'
                                    : 'bg-transparent text-[#666666] dark:text-zinc-400 hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A]'
                            }`}
                        >
                            Por loja
                        </button>
                    </div>
                </div>
                {/* Toggle expandir */}
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="p-1 rounded hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
                    aria-label={expanded ? 'Recolher resumo' : 'Expandir resumo'}
                >
                    {expanded ? (
                        <ChevronUp className="h-4 w-4 text-[#666666] dark:text-zinc-400" />
                    ) : (
                        <ChevronDown className="h-4 w-4 text-[#666666] dark:text-zinc-400" />
                    )}
                </button>
            </div>

            {/* ─── Aba: Por departamento ─────────────────────────────────────── */}
            {activeTab === 'dept' && (
                expanded ? (
                    <div className="border-t border-[#E8E8E8] dark:border-[#333333] p-4">
                        {isLoading ? (
                            <div className="flex gap-3 overflow-x-auto pb-1">
                                {[1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}
                            </div>
                        ) : (
                            <div className="flex gap-3 overflow-x-auto pb-1">
                                {summary.map((item) => {
                                    const badgeColors = DEPARTMENT_COLORS[item.department] ?? DEPARTMENT_FALLBACK_COLOR;
                                    const progressColor = DEPT_PROGRESS_COLORS[item.department] ?? '[&>[data-radix-progress-indicator]]:bg-zinc-500';
                                    const label = DEPARTMENTS_MAP[item.department as keyof typeof DEPARTMENTS_MAP] ?? item.department;
                                    const pct = Math.round(item.percent_verified);

                                    return (
                                        <SummaryCard
                                            key={item.department}
                                            label={label}
                                            badgeClassName={badgeColors}
                                            pct={pct}
                                            progressColorClass={progressColor}
                                            verified={item.verified}
                                            waiting={item.waiting}
                                            wrong={item.wrong}
                                            cancelled={item.cancelled}
                                            total={item.total}
                                            onVerifiedClick={() => onFilterClick?.(item.department, 'verified')}
                                            onWaitingClick={() => onFilterClick?.(item.department, 'waiting')}
                                            onWrongClick={() => onFilterClick?.(item.department, 'wrong')}
                                            onCancelledClick={() => onFilterClick?.(item.department, 'cancelled')}
                                            onTotalClick={() => onFilterClick?.(item.department, 'all')}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="border-t border-[#E8E8E8] dark:border-[#333333]">
                        {isLoading ? (
                            <div className="px-4 py-2 flex gap-4 overflow-x-auto">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton key={i} className="h-5 w-48 rounded shrink-0" />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-2">
                                {summary.map((item) => {
                                    const badgeColors = DEPARTMENT_COLORS[item.department] ?? DEPARTMENT_FALLBACK_COLOR;
                                    const label = DEPARTMENTS_MAP[item.department as keyof typeof DEPARTMENTS_MAP] ?? item.department;
                                    const pct = Math.round(item.percent_verified);

                                    return (
                                        <button
                                            key={item.department}
                                            type="button"
                                            onClick={() => setExpanded(true)}
                                            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                                        >
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${badgeColors}`}>
                                                {label}
                                            </span>
                                            <span className="flex items-center gap-1.5 text-xs text-[#666666] dark:text-zinc-400">
                                                <span className="font-semibold text-green-600 dark:text-green-400">{item.verified}</span>
                                                <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                                                <span className="font-semibold text-red-500 dark:text-red-400">{item.wrong}</span>
                                                <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                                                <span className="font-semibold text-amber-500 dark:text-amber-400">{item.waiting}</span>
                                                <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                                                <span className="font-semibold text-[#111111] dark:text-white">{item.total}</span>
                                                <span className="text-[#999999] dark:text-zinc-500">{pct}%</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )
            )}

            {/* ─── Aba: Por loja ────────────────────────────────────────────── */}
            {activeTab === 'store' && (
                expanded ? (
                    <div className="border-t border-[#E8E8E8] dark:border-[#333333] p-4">
                        {storeSummaryLoading ? (
                            <div className="flex gap-3 overflow-x-auto pb-1">
                                {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
                            </div>
                        ) : storeSummary.length === 0 ? (
                            <p className="text-sm text-center text-[#999999] dark:text-zinc-500 py-4">
                                Nenhum dado de loja para o período.
                            </p>
                        ) : (
                            <div className="flex gap-3 overflow-x-auto pb-1">
                                {storeSummary.map((item) => {
                                    const pct = Math.round(item.percent_verified);
                                    return (
                                        <SummaryCard
                                            key={item.store_id}
                                            label={item.store_name}
                                            pct={pct}
                                            progressColorClass="[&>[data-radix-progress-indicator]]:bg-[#F5A800]"
                                            verified={item.verified}
                                            waiting={item.waiting}
                                            wrong={item.wrong}
                                            cancelled={item.cancelled}
                                            total={item.total}
                                            storeVariant
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="border-t border-[#E8E8E8] dark:border-[#333333]">
                        {storeSummaryLoading ? (
                            <div className="px-4 py-2 flex gap-4 overflow-x-auto">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton key={i} className="h-5 w-40 rounded shrink-0" />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-2">
                                {storeSummary.map((item) => {
                                    const pct = Math.round(item.percent_verified);
                                    return (
                                        <button
                                            key={item.store_id}
                                            type="button"
                                            onClick={() => setExpanded(true)}
                                            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                                        >
                                            <span className="text-xs font-semibold text-[#111111] dark:text-white">
                                                {item.store_name}
                                            </span>
                                            <span className="flex items-center gap-1.5 text-xs text-[#666666] dark:text-zinc-400">
                                                <span className="font-semibold text-green-600 dark:text-green-400">{item.verified}</span>
                                                <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                                                <span className="font-semibold text-red-500 dark:text-red-400">{item.wrong}</span>
                                                <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                                                <span className="font-semibold text-amber-500 dark:text-amber-400">{item.waiting}</span>
                                                <span className="text-[#D1D1D1] dark:text-zinc-600">●</span>
                                                <span className="font-semibold text-blue-600 dark:text-blue-400">{item.total}</span>
                                                <span className="text-[#999999] dark:text-zinc-500">{pct}%</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )
            )}
        </div>
    );
}
