import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/services/api/client';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';
import { useFechamentoFiltersStore } from '@/stores/filters.store';
import type { ServiceOrder } from '@/types/service-order.types';
import { DEPARTMENTS_MAP } from '@/constants/service-orders';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileSpreadsheet, Download, ChevronDown, ChevronRight, LayoutList } from 'lucide-react';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDateBR(value: string | null | undefined): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Remove tags [CORTESIA]/[RETORNO] das observações (mesmo padrão da Conferência)
function cleanNotes(notes: string | null | undefined): string {
    if (!notes) return '—';
    const clean = notes
        .replace(/\s*\|\s*\[CORTESIA\]|\[CORTESIA\]\s*\|\s*/g, '')
        .replace(/\s*\|\s*\[RETORNO\]|\[RETORNO\]\s*\|\s*/g, '')
        .trim();
    return clean || '—';
}

type OrderWithItems = ServiceOrder & {
    items?: Array<{ unit_price?: number; quantity?: number; service_name?: string | null }>;
    is_courtesy?: boolean;
    is_galpon?: boolean;
};

function calcTotal(order: OrderWithItems): number {
    if (!order.items || order.items.length === 0) return 0;
    return order.items.reduce((sum, item) => {
        return sum + (item.unit_price ?? 0) * (item.quantity ?? 1);
    }, 0);
}

function isLavagemSimplesItem(item: { service_name?: string | null }): boolean {
    return !!item.service_name?.toLowerCase().includes('lavagem simples');
}

// Padrões de serviço "de lavagem" para o split VN/VU Lavagem (inclui Ducha e
// Test Drive). Mesma lista enviada ao export do card via service_name_contains/
// service_name_not_contains — manter em sincronia com o FechamentoScreen mobile.
const LAVAGEM_VN_VU_PATTERNS = [
    'lavagem', 'ducha', 'test drive', 'teste drive', 'lav c/aspira', 'lav. simples', 'lav test',
];

function isLavagemVnVuItem(item: { service_name?: string | null }): boolean {
    const name = item.service_name?.toLowerCase();
    return !!name && LAVAGEM_VN_VU_PATTERNS.some((p) => name.includes(p));
}

const FECHAMENTO_PAGE_SIZE = 500;
const FECHAMENTO_MAX_PAGES = 20; // hard-stop de segurança (10.000 registros)

/**
 * Busca todas as páginas do período para o agrupamento do Fechamento não
 * truncar (o agrupamento é client-side; uma página só de 500 fazia faltar
 * O.S. quando o período passava desse total).
 */
async function fetchAllOrders(
    params: Omit<Parameters<typeof serviceOrdersService.getFiltered>[0], 'page' | 'limit'>,
) {
    const first = await serviceOrdersService.getFiltered({
        ...params, page: 1, limit: FECHAMENTO_PAGE_SIZE,
    });
    const items = [...first.items];
    const total = first.total;
    let page = 1;
    while (items.length < total && page < FECHAMENTO_MAX_PAGES) {
        page += 1;
        const next = await serviceOrdersService.getFiltered({
            ...params, page, limit: FECHAMENTO_PAGE_SIZE,
        });
        if (next.items.length === 0) break;
        items.push(...next.items);
    }
    return { items, total, truncated: items.length < total };
}

// ─── types ───────────────────────────────────────────────────────────────────

type ServiceGroupEntry = {
    order: OrderWithItems;
    itemTotal: number;
};

type ServiceGroup = {
    serviceName: string;
    entries: ServiceGroupEntry[];
    count: number;
    total: number;
};

type DeptGroup = {
    deptKey: string;
    label: string;
    services: ServiceGroup[];
    /** Set of unique O.S. IDs that have at least one item in this bucket */
    orderIds: Set<number>;
    count: number;
    total: number;
    /** Params to pass to the per-card download endpoint */
    exportParams: Record<string, string | string[] | boolean | number | undefined>;
};

// Ordem de exibição dos departamentos
const DEPT_ORDER = ['film', 'security_film', 'ppf', 'vn', 'vn_lavagem', 'vd', 'vu', 'vu_lavagem', 'bodywork', 'workshop_servicos', 'workshop_lavagem', 'workshop_courtesy', 'retorno', 'canceladas'];

const VIRTUAL_LABELS: Record<string, string> = {
    vn_lavagem: 'VN Lavagem',
    vu_lavagem: 'VU Lavagem',
    workshop_servicos: 'Oficina Serviços',
    workshop_courtesy: 'Oficina Cortesia',
    workshop_lavagem: 'Oficina Lavagem Simples',
    retorno: 'Retorno',
    canceladas: 'Canceladas',
};

// ─── component ───────────────────────────────────────────────────────────────

export function FechamentoPage() {
    const user = useAuthStore((s) => s.user);
    const { selectedStoreId, availableStores } = useStoreStore();
    const [isExporting, setIsExporting] = useState(false);
    const [isExportingResumo, setIsExportingResumo] = useState(false);
    const [exportingCardKey, setExportingCardKey] = useState<string | null>(null);

    // Filtros persistidos na sessão (sessionStorage): sobrevivem à navegação
    // e ao F5; resetam ao fechar o navegador. storeId null = usa o fallback.
    const {
        storeId: persistedStoreId, dateFrom, dateTo,
        setStoreId, setDateFrom, setDateTo,
    } = useFechamentoFiltersStore();
    const storeId = persistedStoreId
        ?? selectedStoreId ?? user?.store_id ?? availableStores[0]?.id ?? 0;

    const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
    const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());
    // departamentos selecionados que entram no Total Geral
    const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());

    const selectedStore = availableStores.find((s) => s.id === storeId);
    const storeName = selectedStore?.name ?? `Loja #${storeId}`;

    const { data, isLoading: isLoadingVerified, isError: isErrorVerified, refetch: refetchVerified } = useQuery({
        queryKey: ['service-orders', 'fechamento', storeId, dateFrom, dateTo],
        queryFn: () =>
            fetchAllOrders({
                store_id: storeId || undefined,
                is_verified: true,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
            }),
        enabled: true,
    });

    const { data: cancelledData, isLoading: isLoadingCancelled, isError: isErrorCancelled, refetch: refetchCancelled } = useQuery({
        queryKey: ['service-orders', 'fechamento-canceladas', storeId, dateFrom, dateTo],
        queryFn: () =>
            fetchAllOrders({
                store_id: storeId || undefined,
                status: 'cancelled',
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
            }),
        enabled: true,
    });

    const isLoading = isLoadingVerified || isLoadingCancelled;
    // Tela financeira: erro NUNCA pode parecer "não há O.S." — o fechamento
    // do mês sairia incompleto (achado ALTO-4 da auditoria)
    const isError = isErrorVerified || isErrorCancelled;
    const refetchAll = () => {
        if (isErrorVerified) void refetchVerified();
        if (isErrorCancelled) void refetchCancelled();
    };
    const orders = (data?.items ?? []) as OrderWithItems[];
    const cancelledOrders = (cancelledData?.items ?? []) as OrderWithItems[];
    const allOrders = useMemo(() => [...orders, ...cancelledOrders], [orders, cancelledOrders]);

    // ── agrupamento em dois níveis ──────────────────────────────────────────
    const groupedDetailed = useMemo<DeptGroup[]>(() => {
        // serviceMap: bucket → serviceName → entries (acumula itemTotal quando mesma O.S. repete serviço)
        const deptMap = new Map<string, Map<string, ServiceGroupEntry[]>>();

        /**
         * Adiciona um (order, item) a um bucket/serviceKey, acumulando itemTotal
         * quando a mesma O.S. já está registrada para aquele serviço (O.S. com
         * itens repetidos, ou chamada múltipla para a mesma OS/svcKey).
         */
        const addEntry = (
            key: string,
            svcKey: string,
            order: OrderWithItems,
            itemValue: number,
        ) => {
            if (!deptMap.has(key)) deptMap.set(key, new Map());
            const serviceMap = deptMap.get(key)!;
            if (!serviceMap.has(svcKey)) serviceMap.set(svcKey, []);
            const entries = serviceMap.get(svcKey)!;
            const existing = entries.find((e) => e.order.id === order.id);
            if (existing) {
                // Mesma O.S. com mesmo serviço: acumula valor (ex.: 2 itens de "Polimento")
                existing.itemTotal += itemValue;
            } else {
                entries.push({ order, itemTotal: itemValue });
            }
        };

        for (const order of allOrders) {
            const dept = order.department as string;

            // ── Canceladas: card próprio com total da O.S. inteira ──────────
            if (order.status === 'cancelled') {
                const items = order.items ?? [];
                if (items.length === 0) {
                    addEntry('canceladas', '—', order, calcTotal(order));
                } else {
                    for (const item of items) {
                        addEntry('canceladas', item.service_name || '—', order,
                            (item.unit_price ?? 0) * (item.quantity ?? 1));
                    }
                }
                continue;
            }

            // ── Retorno: card próprio com total da O.S. inteira ─────────────
            if (order.is_return) {
                const items = order.items ?? [];
                if (items.length === 0) {
                    addEntry('retorno', '—', order, calcTotal(order));
                } else {
                    for (const item of items) {
                        addEntry('retorno', item.service_name || '—', order,
                            (item.unit_price ?? 0) * (item.quantity ?? 1));
                    }
                }
                continue;
            }

            // ── Workshop ─────────────────────────────────────────────────────
            if (dept === 'workshop') {
                // Classificação POR ITEM: Lavagem Simples vai SEMPRE para o card
                // "Oficina Lavagem Simples", mesmo em O.S. cortesia (mesma regra do
                // resumo Excel); demais itens vão para Cortesia ou Serviços
                // conforme a flag da O.S.
                const items = order.items ?? [];
                const restBucket = order.is_courtesy ? 'workshop_courtesy' : 'workshop_servicos';
                if (items.length === 0) {
                    addEntry(restBucket, '—', order, 0);
                } else {
                    for (const item of items) {
                        const bucket = isLavagemSimplesItem(item) ? 'workshop_lavagem' : restBucket;
                        addEntry(bucket, item.service_name || '—', order,
                            (item.unit_price ?? 0) * (item.quantity ?? 1));
                    }
                }
                continue;
            }

            // ── VN / VU ──────────────────────────────────────────────────────
            if (dept === 'vn' || dept === 'vu') {
                // Classificação POR ITEM: lavagens (incluindo Ducha e Test Drive)
                // vão para o card "VN/VU Lavagem"; demais itens ficam em VN/VU
                const items = order.items ?? [];
                if (items.length === 0) {
                    addEntry(dept, '—', order, calcTotal(order));
                } else {
                    for (const item of items) {
                        const bucket = isLavagemVnVuItem(item) ? `${dept}_lavagem` : dept;
                        addEntry(bucket, item.service_name || '—', order,
                            (item.unit_price ?? 0) * (item.quantity ?? 1));
                    }
                }
                continue;
            }

            // ── Demais departamentos ─────────────────────────────────────────
            const items = order.items ?? [];
            if (items.length === 0) {
                addEntry(dept, '—', order, calcTotal(order));
            } else {
                for (const item of items) {
                    addEntry(dept, item.service_name || '—', order,
                        (item.unit_price ?? 0) * (item.quantity ?? 1));
                }
            }
        }

        const result: DeptGroup[] = [];

        for (const key of DEPT_ORDER) {
            // "Oficina Lavagem Simples" é sempre exibida, mesmo sem O.S. no período
            const serviceMap = deptMap.get(key)
                ?? (key === 'workshop_lavagem' ? new Map<string, ServiceGroupEntry[]>() : undefined);
            if (!serviceMap) continue;

            const label = VIRTUAL_LABELS[key] ?? DEPARTMENTS_MAP[key as keyof typeof DEPARTMENTS_MAP] ?? key;

            const services: ServiceGroup[] = Array.from(serviceMap.entries()).map(
                ([serviceName, entries]) => ({
                    serviceName,
                    entries,
                    count: entries.length,
                    total: entries.reduce((s, e) => s + e.itemTotal, 0),
                }),
            );

            // orderIds: union de O.S. únicas neste bucket (D2)
            // Para workshop_lavagem e workshop_servicos uma mesma O.S. mista pode
            // aparecer nos dois buckets — count = orderIds.size reflete O.S. únicas
            // dentro do card (não do Total Geral).
            const orderIds = new Set<number>(
                Array.from(serviceMap.values()).flat().map((e) => e.order.id),
            );
            const count = orderIds.size;
            // Total = soma dos itemTotals das entries (correto por item, sem calcTotal por O.S.)
            const total = services.reduce((s, sg) => s + sg.total, 0);

            // Params para download do card
            let exportParams: DeptGroup['exportParams'] = {
                store_id: storeId || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
            };
            if (key === 'canceladas') {
                exportParams = { ...exportParams, status: 'cancelled' };
            } else if (key === 'retorno') {
                exportParams = { ...exportParams, is_return: true };
            } else if (key === 'workshop_courtesy') {
                // Itens de Lavagem Simples ficam fora do card Cortesia (vão para
                // "Oficina Lavagem Simples")
                exportParams = {
                    ...exportParams,
                    department: 'workshop',
                    is_courtesy: true,
                    service_name_not_contains: 'Lavagem Simples',
                    is_return: false,
                };
            } else if (key === 'workshop_lavagem') {
                // Sem filtro de cortesia: lavagens simples cortesia entram aqui
                exportParams = {
                    ...exportParams,
                    department: 'workshop',
                    service_name_contains: 'Lavagem Simples',
                    is_return: false,
                };
            } else if (key === 'workshop_servicos') {
                exportParams = {
                    ...exportParams,
                    department: 'workshop',
                    is_courtesy: false,
                    service_name_not_contains: 'Lavagem Simples',
                    is_return: false,
                };
            } else if (key === 'vn_lavagem' || key === 'vu_lavagem') {
                // Só itens de lavagem (incluindo Ducha e Test Drive)
                exportParams = {
                    ...exportParams,
                    department: key === 'vn_lavagem' ? 'vn' : 'vu',
                    service_name_contains: LAVAGEM_VN_VU_PATTERNS,
                    is_return: false,
                };
            } else if (key === 'vn' || key === 'vu') {
                // Itens de lavagem ficam fora (vão para o card VN/VU Lavagem)
                exportParams = {
                    ...exportParams,
                    department: key,
                    service_name_not_contains: LAVAGEM_VN_VU_PATTERNS,
                    is_return: false,
                };
            } else {
                exportParams = { ...exportParams, department: key, is_return: false };
            }

            result.push({ deptKey: key, label, services, orderIds, count, total, exportParams });
        }

        return result;
    }, [allOrders, storeId, dateFrom, dateTo]);

    // grandTotal e grandCount consideram apenas os departamentos selecionados.
    // Uma O.S. mista de Oficina (Lavagem + Serviços) pode aparecer em
    // workshop_lavagem e workshop_servicos ao mesmo tempo; grandCount deduplica
    // pela união dos orderIds de todos os grupos selecionados.
    const selectedGroups = groupedDetailed.filter((g) => selectedDepts.has(g.deptKey));
    const grandTotal = selectedGroups.reduce((s, g) => s + g.total, 0);
    const grandOrderIds = new Set<number>(selectedGroups.flatMap((g) => Array.from(g.orderIds)));
    const grandCount = grandOrderIds.size;
    const totalDeptCount = groupedDetailed.length;
    const selectedDeptCount = selectedGroups.length;

    // Expandir todos os departamentos quando os dados chegam
    useEffect(() => {
        setExpandedDepts(new Set(groupedDetailed.map((g) => g.deptKey)));
    }, [groupedDetailed.length]);

    // Selecionar por padrão todos os departamentos de receita (exceto retorno e
    // canceladas) quando o conjunto de departamentos disponíveis muda.
    useEffect(() => {
        setSelectedDepts(
            new Set(
                groupedDetailed
                    .map((g) => g.deptKey)
                    .filter((k) => k !== 'retorno' && k !== 'canceladas'),
            ),
        );
    }, [groupedDetailed.length]);

    const toggleDept = (key: string) => {
        setExpandedDepts((prev) => {
            const next = new Set(prev);
            if (next.has(key)) { next.delete(key); } else { next.add(key); }
            return next;
        });
    };

    const toggleService = (key: string) => {
        setExpandedServices((prev) => {
            const next = new Set(prev);
            if (next.has(key)) { next.delete(key); } else { next.add(key); }
            return next;
        });
    };

    const toggleDeptSelection = (key: string) => {
        setSelectedDepts((prev) => {
            const next = new Set(prev);
            if (next.has(key)) { next.delete(key); } else { next.add(key); }
            return next;
        });
    };

    // ── export handlers ─────────────────────────────────────────────────────

    const downloadBlob = (blobData: BlobPart, fileName: string) => {
        const blob = new Blob([blobData], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const response = await apiClient.get('/service-orders/export/fechamento', {
                params: { store_id: storeId || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined, is_return: false },
                responseType: 'blob',
            });
            downloadBlob(response.data, `fechamento_${storeName.replace(/\s/g, '_')}_${dateFrom}_${dateTo}.xlsx`);
        } catch (err) {
            if (import.meta.env.DEV) console.error('Erro ao exportar fechamento:', err);
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportResumo = async () => {
        setIsExportingResumo(true);
        try {
            const response = await apiClient.get('/service-orders/export/fechamento-resumo', {
                params: { store_id: storeId || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined },
                responseType: 'blob',
            });
            downloadBlob(response.data, `resumo_fechamento_${storeName.replace(/\s/g, '_')}_${dateFrom}_${dateTo}.xlsx`);
        } catch (err) {
            if (import.meta.env.DEV) console.error('Erro ao exportar resumo:', err);
        } finally {
            setIsExportingResumo(false);
        }
    };

    const handleExportCard = async (group: DeptGroup) => {
        setExportingCardKey(group.deptKey);
        try {
            const response = await apiClient.get('/service-orders/export/fechamento', {
                params: group.exportParams,
                // Arrays repetem a chave sem colchetes (service_name_contains=a&...=b),
                // formato que o FastAPI espera para list[str]
                paramsSerializer: { indexes: null },
                responseType: 'blob',
            });
            downloadBlob(
                response.data,
                `fechamento_${group.label.replace(/\s/g, '_')}_${storeName.replace(/\s/g, '_')}_${dateFrom}_${dateTo}.xlsx`,
            );
        } catch (err) {
            if (import.meta.env.DEV) console.error('Erro ao exportar card:', err);
        } finally {
            setExportingCardKey(null);
        }
    };

    // ── render ───────────────────────────────────────────────────────────────

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Header + Filters */}
            <div className="space-y-3">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-[#111111] dark:text-white text-xl font-bold"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Fechamento
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Extrato financeiro de OS verificadas
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <button
                        onClick={handleExportResumo}
                        disabled={orders.length === 0 || isExportingResumo}
                        title="Exportar resumo por departamento/serviço"
                        className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] transition-all border border-[#F5A800] bg-transparent"
                        style={{ color: '#F5A800' }}
                    >
                        <LayoutList className="h-4 w-4" />
                        {isExportingResumo ? 'Exportando...' : 'Exportar Resumo'}
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={orders.length === 0 || isExporting}
                        className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] transition-all"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Download className="h-4 w-4" />
                        {isExporting ? 'Exportando...' : 'Exportar Excel'}
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-end gap-3 p-4 bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl">
                {availableStores.length > 1 && (
                    <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-400">Loja</Label>
                        <Select value={storeId.toString()} onValueChange={(v) => setStoreId(Number(v))}>
                            <SelectTrigger className="w-44 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                <SelectValue placeholder="Selecionar loja" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                {availableStores.map((s) => (
                                    <SelectItem key={s.id} value={s.id.toString()} className="focus:bg-zinc-700 focus:text-white">
                                        {s.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-400">Data início</Label>
                    <Input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="w-40 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus-visible:ring-[#F5A800] dark:[color-scheme:dark]"
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-[#666666] dark:text-zinc-400">Data fim</Label>
                    <Input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="w-40 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus-visible:ring-[#F5A800] dark:[color-scheme:dark]"
                    />
                </div>
            </div>
            </div>{/* end space-y-3 */}

            {/* Summary info */}
            {!isLoading && (
                <p className="text-sm text-[#666666] dark:text-zinc-400">
                    {grandCount} OS verificadas encontradas para{' '}
                    <strong className="text-[#111111] dark:text-zinc-200">{storeName}</strong> no período {dateFrom} a {dateTo}
                </p>
            )}
            {!isLoading && (data?.truncated || cancelledData?.truncated) && (
                <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                    Período com mais de 10.000 registros — exibição truncada; reduza o período
                </p>
            )}

            {/* Cards por departamento → subcategorias de serviço → OS */}
            <div className="space-y-2">
                {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                            <Skeleton className="h-5 w-48 bg-gray-200 dark:bg-zinc-800 animate-pulse rounded" />
                        </div>
                    ))
                ) : isError ? (
                    <div className="border border-red-300 dark:border-red-900 rounded-xl px-4 py-12 text-center space-y-3">
                        <p className="flex items-center justify-center gap-2 text-red-500 text-sm font-medium">
                            <AlertCircle className="w-4 h-4" />
                            Erro ao carregar as O.S. do fechamento. Os dados exibidos podem estar incompletos.
                        </p>
                        <Button variant="outline" size="sm" onClick={refetchAll}>
                            Tentar novamente
                        </Button>
                    </div>
                ) : allOrders.length === 0 ? (
                    <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl px-4 py-12 text-center text-[#999999] dark:text-zinc-500">
                        Nenhuma OS verificada encontrada para o período selecionado
                    </div>
                ) : (
                    groupedDetailed.map((group) => {
                        const isDeptOpen = expandedDepts.has(group.deptKey);
                        const isSelected = selectedDepts.has(group.deptKey);

                        return (
                            <div
                                key={group.deptKey}
                                className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden"
                            >
                                {/* ── Cabeçalho do departamento ── */}
                                <div className="flex items-center bg-gray-100 dark:bg-zinc-800/60">
                                    {/* Checkbox: inclui/exclui o departamento do Total Geral */}
                                    <div className="flex items-center pl-4 pr-1 self-stretch">
                                        <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={() => toggleDeptSelection(group.deptKey)}
                                            aria-label={`Incluir ${group.label} no total`}
                                            title={isSelected ? 'Excluir do total' : 'Incluir no total'}
                                        />
                                    </div>
                                    <button
                                        onClick={() => toggleDept(group.deptKey)}
                                        className={`flex-1 flex items-center gap-2 pl-1 pr-4 py-3 hover:bg-gray-200 dark:hover:bg-zinc-800 transition-colors text-left ${isSelected ? '' : 'opacity-50'}`}
                                    >
                                        {isDeptOpen
                                            ? <ChevronDown className="h-4 w-4 text-[#666666] dark:text-zinc-400 shrink-0" />
                                            : <ChevronRight className="h-4 w-4 text-[#666666] dark:text-zinc-400 shrink-0" />}
                                        <span className="font-semibold text-[#111111] dark:text-white">{group.label}</span>
                                        <span className="text-xs text-[#666666] dark:text-zinc-400 ml-1">{group.count} OS</span>
                                    </button>
                                    {/* Download do card */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleExportCard(group); }}
                                        disabled={exportingCardKey === group.deptKey}
                                        title={`Exportar ${group.label}`}
                                        className="px-3 py-3 text-[#666666] dark:text-zinc-400 hover:text-[#F5A800] dark:hover:text-[#F5A800] disabled:opacity-40 transition-colors"
                                    >
                                        <Download className="h-4 w-4" />
                                    </button>
                                    <span
                                        className={`pr-4 font-bold tabular-nums text-sm ${isSelected ? '' : 'opacity-50'}`}
                                        style={{ color: '#F5A800' }}
                                    >
                                        {formatCurrency(group.total)}
                                    </span>
                                </div>

                                {/* ── Subcategorias de serviço ── */}
                                {isDeptOpen && (
                                    <div className="divide-y divide-[#E8E8E8] dark:divide-[#333333]">
                                        {group.services.map((svcGroup) => {
                                            const svcKey = `${group.deptKey}__${svcGroup.serviceName}`;
                                            const isSvcOpen = expandedServices.has(svcKey);
                                            const showCourtesyCol = group.deptKey !== 'workshop_courtesy';

                                            return (
                                                <div key={svcKey}>
                                                    {/* Linha da subcategoria */}
                                                    <button
                                                        onClick={() => toggleService(svcKey)}
                                                        className="w-full flex items-center gap-2 px-6 py-2.5 bg-gray-50 dark:bg-zinc-800/20 hover:bg-gray-100 dark:hover:bg-zinc-800/40 transition-colors text-left"
                                                    >
                                                        {isSvcOpen
                                                            ? <ChevronDown className="h-3.5 w-3.5 text-[#999999] dark:text-zinc-500 shrink-0" />
                                                            : <ChevronRight className="h-3.5 w-3.5 text-[#999999] dark:text-zinc-500 shrink-0" />}
                                                        <span className="flex-1 text-sm font-medium text-[#333333] dark:text-zinc-300">
                                                            {svcGroup.serviceName}
                                                        </span>
                                                        <span className="text-xs text-[#999999] dark:text-zinc-500 mr-4">
                                                            {svcGroup.count} OS
                                                        </span>
                                                        <span className="text-sm font-semibold tabular-nums text-[#555555] dark:text-zinc-300">
                                                            {formatCurrency(svcGroup.total)}
                                                        </span>
                                                    </button>

                                                    {/* Tabela de OS da subcategoria */}
                                                    {isSvcOpen && (
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="bg-white dark:bg-[#1E1E1E]">
                                                                    <th className="text-left px-8 py-2 font-semibold text-[#666666] dark:text-zinc-400 text-xs uppercase tracking-wide">Data</th>
                                                                    <th className="text-left px-4 py-2 font-semibold text-[#666666] dark:text-zinc-400 text-xs uppercase tracking-wide">Placa</th>
                                                                    <th className="text-left px-4 py-2 font-semibold text-[#666666] dark:text-zinc-400 text-xs uppercase tracking-wide">Nº OS</th>
                                                                    <th className="text-left px-4 py-2 font-semibold text-[#666666] dark:text-zinc-400 text-xs uppercase tracking-wide">Obs</th>
                                                                    <th className="text-left px-4 py-2 font-semibold text-[#666666] dark:text-zinc-400 text-xs uppercase tracking-wide">Obs. Interna</th>
                                                                    {showCourtesyCol && (
                                                                        <th className="text-left px-4 py-2 font-semibold text-[#666666] dark:text-zinc-400 text-xs uppercase tracking-wide">Cortesia/Galpão</th>
                                                                    )}
                                                                    <th className="text-right px-4 py-2 font-semibold text-[#666666] dark:text-zinc-400 text-xs uppercase tracking-wide">Valor</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {svcGroup.entries.map(({ order, itemTotal }) => (
                                                                    <tr
                                                                        key={order.id}
                                                                        className="border-t border-[#E8E8E8] dark:border-[#333333] hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                                                                    >
                                                                        <td className="px-8 py-2 text-[#111111] dark:text-zinc-200 whitespace-nowrap">
                                                                            {formatDateBR(order.service_date ?? order.created_at)}
                                                                        </td>
                                                                        <td className="px-4 py-2 font-mono text-[#111111] dark:text-zinc-200">
                                                                            {order.plate}
                                                                        </td>
                                                                        <td className="px-4 py-2 text-[#111111] dark:text-zinc-200">
                                                                            {order.external_os_number || '—'}
                                                                        </td>
                                                                        <td className="px-4 py-2 text-[#666666] dark:text-zinc-400 max-w-[180px]">
                                                                            <span
                                                                                className="block truncate"
                                                                                title={cleanNotes(order.notes) !== '—' ? cleanNotes(order.notes) : undefined}
                                                                            >
                                                                                {cleanNotes(order.notes)}
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-[#666666] dark:text-zinc-400 max-w-[180px]">
                                                                            <span className="block truncate" title={order.internal_notes || undefined}>
                                                                                {order.internal_notes || '—'}
                                                                            </span>
                                                                        </td>
                                                                        {showCourtesyCol && (
                                                                            <td className="px-4 py-2">
                                                                                <div className="flex flex-wrap gap-1">
                                                                                    {order.is_courtesy && (
                                                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                                                                                            Cortesia
                                                                                        </span>
                                                                                    )}
                                                                                    {order.is_galpon && (
                                                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                                                                                            Galpão
                                                                                        </span>
                                                                                    )}
                                                                                    {!order.is_courtesy && !order.is_galpon && (
                                                                                        <span className="text-xs text-[#999999] dark:text-zinc-500">—</span>
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                        )}
                                                                        <td className="px-4 py-2 text-right font-medium tabular-nums text-[#111111] dark:text-zinc-200">
                                                                            {formatCurrency(itemTotal)}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}

                {/* Total Geral */}
                {!isLoading && totalDeptCount > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-2 border-[#F5A800]/30 bg-gray-100 dark:bg-zinc-800/80 rounded-xl">
                        <span className="font-bold text-[#111111] dark:text-zinc-100">
                            {selectedDeptCount < totalDeptCount
                                ? `TOTAL SELECIONADO — ${grandCount} OS`
                                : `TOTAL GERAL — ${grandCount} OS`}
                            {selectedDeptCount < totalDeptCount && (
                                <span className="ml-2 text-xs font-normal text-[#666666] dark:text-zinc-400">
                                    ({selectedDeptCount} de {totalDeptCount} departamentos)
                                </span>
                            )}
                        </span>
                        <span className="font-bold tabular-nums text-lg" style={{ color: '#F5A800' }}>
                            {formatCurrency(grandTotal)}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
