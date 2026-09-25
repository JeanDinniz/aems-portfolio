import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { StoreSelector } from '@/components/common/StoreSelector';
import { useStoreStore } from '@/stores/store.store';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { DEPARTMENTS_MAP } from '@/constants/service-orders';
import { formatCurrencyBRL } from '@/utils/formatNumber';
import { getApiErrorMessage } from '@/lib/api-error';
import { useCanView } from '@/hooks/useMyPermissions';
import { CONFERENCE_ENABLED } from '@/constants/features';
import type { Department, ServiceOrder } from '@/types/service-order.types';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * CONF-02/03 — Fechamento mensal (Sprint 6, Fatia 4).
 *
 * Espelha o web `FechamentoPage`: agrupa as O.S. verificadas (mais as
 * canceladas) por departamento na ORDEM FIXA, exibindo contagem e receita por
 * grupo, com export Excel por card + export completo/resumo no topo.
 *
 * Regras de agrupamento (idênticas ao web):
 * - status `cancelled` → grupo `canceladas` (prioridade máxima);
 * - `is_return` → grupo `retorno`;
 * - department `workshop` → classificação POR ITEM: itens "lavagem simples"
 *   vão SEMPRE ao grupo `workshop_lavagem` (mesmo em O.S. cortesia — mesma
 *   regra do resumo Excel); os demais itens vão a `workshop_courtesy` se a
 *   O.S. é cortesia, senão a `workshop_servicos`. Uma O.S. mista aparece nos
 *   DOIS grupos, cada um com o valor apenas dos itens pertinentes (sem dupla
 *   contagem de receita);
 * - O.S. workshop sem itens → `workshop_courtesy` se cortesia, senão
 *   `workshop_servicos`;
 * - demais departments → o próprio department.
 *
 * Receita do grupo = soma de unit_price * quantity dos ITENS roteados àquele
 * grupo. A contagem do grupo = O.S. únicas com ≥1 item nele (mista conta 1× em
 * cada card). O TOTAL GERAL exclui `retorno` e `canceladas` (têm cards próprios)
 * e deduplica a contagem por união de IDs de O.S. — exatamente como o web.
 *
 * Header preto próprio (igual ConferenceScreen) — o AppStack usa
 * `headerShown:false`. Gate por `useCanView('fechamento')`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ordem fixa de exibição dos grupos (idêntica ao web).
const GROUP_ORDER = [
    'film',
    'security_film',
    'ppf',
    'vn',
    'vn_lavagem',
    'vd',
    'vu',
    'vu_lavagem',
    'bodywork',
    'workshop_servicos',
    'workshop_lavagem',
    'workshop_courtesy',
    'retorno',
    'canceladas',
] as const;

const VIRTUAL_LABELS: Record<string, string> = {
    vn_lavagem: 'VN Lavagem',
    vu_lavagem: 'VU Lavagem',
    workshop_servicos: 'Oficina Serviços',
    workshop_lavagem: 'Oficina Lavagem Simples',
    workshop_courtesy: 'Oficina Cortesia',
    retorno: 'Retorno',
    canceladas: 'Canceladas',
};

type OrderWithItems = ServiceOrder & {
    items?: OrderItem[];
    is_courtesy?: boolean;
    is_return?: boolean;
};

interface GroupOrderRow {
    order: OrderWithItems;
    total: number;
}

interface GroupResult {
    key: string;
    label: string;
    count: number;
    total: number;
    /** O.S. do grupo (para a listagem expandível), cada uma com o valor roteado. */
    orders: GroupOrderRow[];
    exportParams: {
        department?: string;
        is_courtesy?: boolean;
        is_return?: boolean;
        service_name_contains?: string | string[];
        service_name_not_contains?: string | string[];
        status?: string;
    };
}

type OrderItem = { unit_price?: number; quantity?: number; service_name?: string | null };

function firstOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}
function today(): string {
    return new Date().toISOString().split('T')[0];
}

function itemTotal(item: OrderItem): number {
    return (item.unit_price ?? 0) * (item.quantity ?? 1);
}

function calcTotal(order: OrderWithItems): number {
    return (order.items ?? []).reduce((sum, item) => sum + itemTotal(item), 0);
}

function isLavagemSimplesItem(item: OrderItem): boolean {
    return item.service_name != null && item.service_name.toLowerCase().includes('lavagem simples');
}

// Padrões de serviço "de lavagem" para o split VN/VU Lavagem (inclui Ducha e
// Test Drive). Mesma lista enviada ao export do card via service_name_contains/
// service_name_not_contains — manter em sincronia com o FechamentoPage web.
const LAVAGEM_VN_VU_PATTERNS = [
    'lavagem', 'ducha', 'test drive', 'teste drive', 'lav c/aspira', 'lav. simples', 'lav test',
];

function isLavagemVnVuItem(item: OrderItem): boolean {
    const name = item.service_name?.toLowerCase();
    return !!name && LAVAGEM_VN_VU_PATTERNS.some((p) => name.includes(p));
}

const FECHAMENTO_PAGE_SIZE = 500;
const FECHAMENTO_MAX_PAGES = 20; // hard-stop de segurança (10.000 registros)

/**
 * Busca todas as páginas do período (igual web) — o agrupamento é client-side
 * e uma página só de 500 fazia faltar O.S. em períodos maiores que isso.
 */
async function fetchAllOrders(
    params: Omit<Parameters<typeof serviceOrdersService.getFiltered>[0], 'page' | 'limit'>
) {
    const first = await serviceOrdersService.getFiltered({
        ...params,
        page: 1,
        limit: FECHAMENTO_PAGE_SIZE,
    });
    const items = [...first.items];
    const total = first.total;
    let page = 1;
    while (items.length < total && page < FECHAMENTO_MAX_PAGES) {
        page += 1;
        const next = await serviceOrdersService.getFiltered({
            ...params,
            page,
            limit: FECHAMENTO_PAGE_SIZE,
        });
        if (next.items.length === 0) break;
        items.push(...next.items);
    }
    return { items, total };
}

/**
 * Roteia uma O.S. para um ou mais buckets, cada bucket com apenas os itens
 * pertinentes e o total desses itens. Uma O.S. workshop mista (lavagem +
 * serviços) devolve DOIS buckets.
 */
function routeOrder(order: OrderWithItems): Array<{ key: string; total: number }> {
    if (order.status === 'cancelled') return [{ key: 'canceladas', total: calcTotal(order) }];
    if (order.is_return) return [{ key: 'retorno', total: calcTotal(order) }];

    const dept = order.department as string;

    // VN / VU: partição POR ITEM. Lavagens (incluindo Ducha e Test Drive) vão
    // para vn_lavagem/vu_lavagem; os demais itens ficam em vn/vu.
    if (dept === 'vn' || dept === 'vu') {
        const items = order.items ?? [];
        if (items.length === 0) return [{ key: dept, total: 0 }];

        let lavagem = 0;
        let resto = 0;
        let hasLavagem = false;
        let hasResto = false;
        for (const item of items) {
            if (isLavagemVnVuItem(item)) {
                lavagem += itemTotal(item);
                hasLavagem = true;
            } else {
                resto += itemTotal(item);
                hasResto = true;
            }
        }

        const buckets: Array<{ key: string; total: number }> = [];
        if (hasLavagem) buckets.push({ key: `${dept}_lavagem`, total: lavagem });
        if (hasResto) buckets.push({ key: dept, total: resto });
        return buckets;
    }

    if (dept !== 'workshop') return [{ key: dept, total: calcTotal(order) }];

    // Workshop: partição POR ITEM. Lavagem Simples vai SEMPRE para
    // workshop_lavagem (mesmo em O.S. cortesia — mesma regra do resumo Excel);
    // os demais itens vão para cortesia ou serviços conforme a flag da O.S.
    const restKey = order.is_courtesy ? 'workshop_courtesy' : 'workshop_servicos';
    const items = order.items ?? [];
    if (items.length === 0) return [{ key: restKey, total: 0 }];

    let lavagem = 0;
    let resto = 0;
    let hasLavagem = false;
    let hasResto = false;
    for (const item of items) {
        if (isLavagemSimplesItem(item)) {
            lavagem += itemTotal(item);
            hasLavagem = true;
        } else {
            resto += itemTotal(item);
            hasResto = true;
        }
    }

    const buckets: Array<{ key: string; total: number }> = [];
    if (hasLavagem) buckets.push({ key: 'workshop_lavagem', total: lavagem });
    if (hasResto) buckets.push({ key: restKey, total: resto });
    return buckets;
}

function exportParamsForGroup(key: string): GroupResult['exportParams'] {
    if (key === 'canceladas') return { status: 'cancelled' };
    if (key === 'retorno') return { is_return: true };
    if (key === 'workshop_courtesy')
        // Itens de Lavagem Simples ficam fora do card Cortesia
        return {
            department: 'workshop',
            is_courtesy: true,
            service_name_not_contains: 'Lavagem Simples',
            is_return: false,
        };
    if (key === 'workshop_lavagem')
        // Sem filtro de cortesia: lavagens simples cortesia entram aqui
        return {
            department: 'workshop',
            service_name_contains: 'Lavagem Simples',
            is_return: false,
        };
    if (key === 'workshop_servicos')
        return {
            department: 'workshop',
            is_courtesy: false,
            service_name_not_contains: 'Lavagem Simples',
            is_return: false,
        };
    if (key === 'vn_lavagem' || key === 'vu_lavagem')
        // Só itens de lavagem (incluindo Ducha e Test Drive)
        return {
            department: key === 'vn_lavagem' ? 'vn' : 'vu',
            service_name_contains: LAVAGEM_VN_VU_PATTERNS,
            is_return: false,
        };
    if (key === 'vn' || key === 'vu')
        // Itens de lavagem ficam fora (vão para o card VN/VU Lavagem)
        return {
            department: key,
            service_name_not_contains: LAVAGEM_VN_VU_PATTERNS,
            is_return: false,
        };
    return { department: key, is_return: false };
}

export function FechamentoScreen({ navigation }: AppStackScreenProps<'Fechamento'>) {
    const toast = useToast();
    const canView = useCanView('fechamento');
    // HML-246: botão "Visualizar" por carro só para quem acessa a Conferência
    // (mesmo padrão do MoreScreen: o hook é chamado SEMPRE — regra de hooks — e
    // a flag de módulo apenas combina com o resultado; Owner = true pelo hook).
    const _canConferenceView = useCanView('conference');
    const canConference = CONFERENCE_ENABLED && _canConferenceView;
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const availableStores = useStoreStore((s) => s.availableStores);

    const [dateFrom, setDateFrom] = useState(firstOfMonth());
    const [dateTo, setDateTo] = useState(today());

    const validFrom = DATE_RE.test(dateFrom) ? dateFrom : undefined;
    const validTo = DATE_RE.test(dateTo) ? dateTo : undefined;

    const storeId = selectedStoreId ?? undefined;
    const storeName = useMemo(() => {
        if (selectedStoreId == null) return 'Todas';
        return availableStores.find((s) => s.id === selectedStoreId)?.name ?? `Loja #${selectedStoreId}`;
    }, [selectedStoreId, availableStores]);

    // Duas queries (igual web): verificadas + canceladas.
    const verifiedQuery = useQuery({
        queryKey: ['service-orders', 'fechamento', storeId ?? null, validFrom, validTo],
        queryFn: () =>
            fetchAllOrders({
                store_id: storeId,
                is_verified: true,
                date_from: validFrom,
                date_to: validTo,
            }),
    });

    const cancelledQuery = useQuery({
        queryKey: ['service-orders', 'fechamento-canceladas', storeId ?? null, validFrom, validTo],
        queryFn: () =>
            fetchAllOrders({
                store_id: storeId,
                status: 'cancelled',
                date_from: validFrom,
                date_to: validTo,
            }),
    });

    const isLoading = verifiedQuery.isLoading || cancelledQuery.isLoading;
    const isError = verifiedQuery.isError || cancelledQuery.isError;

    const allOrders = useMemo<OrderWithItems[]>(
        () => [
            ...((verifiedQuery.data?.items ?? []) as OrderWithItems[]),
            ...((cancelledQuery.data?.items ?? []) as OrderWithItems[]),
        ],
        [verifiedQuery.data, cancelledQuery.data]
    );

    const { groups, grandCount, grandTotal } = useMemo(() => {
        // key → { orderIds únicas (contagem), total acumulado dos itens roteados,
        // orders (linhas por carro, com o valor roteado àquele grupo) }
        const groupMap = new Map<
            string,
            { orderIds: Set<number>; total: number; orders: GroupOrderRow[] }
        >();
        for (const order of allOrders) {
            for (const bucket of routeOrder(order)) {
                let g = groupMap.get(bucket.key);
                if (!g) {
                    g = { orderIds: new Set(), total: 0, orders: [] };
                    groupMap.set(bucket.key, g);
                }
                g.orderIds.add(order.id);
                g.total += bucket.total;
                g.orders.push({ order, total: bucket.total });
            }
        }

        const out: GroupResult[] = [];
        for (const key of GROUP_ORDER) {
            // "Oficina Lavagem Simples" é sempre exibida, mesmo sem O.S. no período
            const g = groupMap.get(key)
                ?? (key === 'workshop_lavagem'
                    ? { orderIds: new Set<number>(), total: 0, orders: [] as GroupOrderRow[] }
                    : undefined);
            if (!g || (g.orderIds.size === 0 && key !== 'workshop_lavagem')) continue;
            const label =
                VIRTUAL_LABELS[key] ?? DEPARTMENTS_MAP[key as Department] ?? key;
            out.push({
                key,
                label,
                count: g.orderIds.size,
                total: g.total,
                orders: g.orders,
                exportParams: exportParamsForGroup(key),
            });
        }

        // Total geral exclui retorno e canceladas (cards próprios) — igual web.
        // Soma dos totais dos grupos (partição por item → sem dupla contagem de
        // receita) e contagem deduplicada por união de IDs de O.S.
        const gTotal = out
            .filter((g) => g.key !== 'retorno' && g.key !== 'canceladas')
            .reduce((s, g) => s + g.total, 0);
        const gCount = new Set(
            allOrders.filter((o) => !o.is_return && o.status !== 'cancelled').map((o) => o.id)
        ).size;

        return { groups: out, grandCount: gCount, grandTotal: gTotal };
    }, [allOrders]);

    // Estado de download por chave: 'completo' | 'resumo' | group.key.
    const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

    const runExport = useCallback(
        async (key: string, fn: () => Promise<void>) => {
            if (downloadingKey) return;
            setDownloadingKey(key);
            try {
                await fn();
                toast.success('Excel gerado.');
            } catch (err) {
                toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o Excel.'));
            } finally {
                setDownloadingKey(null);
            }
        },
        [downloadingKey, toast]
    );

    const handleExportCompleto = useCallback(
        () =>
            runExport('completo', () =>
                serviceOrdersService.exportFechamento({
                    store_id: storeId,
                    date_from: validFrom,
                    date_to: validTo,
                    is_return: false,
                    loja: storeName,
                })
            ),
        [runExport, storeId, validFrom, validTo, storeName]
    );

    const handleExportResumo = useCallback(
        () =>
            runExport('resumo', () =>
                serviceOrdersService.exportFechamentoResumo({
                    store_id: storeId,
                    date_from: validFrom,
                    date_to: validTo,
                    loja: storeName,
                })
            ),
        [runExport, storeId, validFrom, validTo, storeName]
    );

    const handleExportGroup = useCallback(
        (group: GroupResult) =>
            runExport(group.key, () =>
                serviceOrdersService.exportFechamento({
                    store_id: storeId,
                    date_from: validFrom,
                    date_to: validTo,
                    loja: storeName,
                    ...group.exportParams,
                })
            ),
        [runExport, storeId, validFrom, validTo, storeName]
    );

    // Abre a O.S. no editor. Navegação aninhada (mesmo padrão da Conferência):
    // AppStack → Tabs → ServiceOrders → EditServiceOrder.
    const openOrder = useCallback(
        (id: number) => {
            navigation.navigate('Tabs', {
                screen: 'ServiceOrders',
                params: { screen: 'EditServiceOrder', params: { id } },
            });
        },
        [navigation]
    );

    const subtitle = isLoading
        ? 'Carregando...'
        : `${grandCount} ${grandCount === 1 ? 'O.S verificada' : 'O.S verificadas'}`;

    // ─── Gate de permissão ───────────────────────────────────────────────────
    if (!canView) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <FechamentoHeader subtitle="" onBack={() => navigation.goBack()} />
                <EmptyState
                    icon="lock-closed-outline"
                    title="Acesso restrito"
                    description="Você não tem permissão para ver o Fechamento."
                />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <FechamentoHeader
                subtitle={subtitle}
                onBack={() => navigation.goBack()}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onChangeFrom={setDateFrom}
                onChangeTo={setDateTo}
            />

            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState
                    onRetry={() => {
                        void verifiedQuery.refetch();
                        void cancelledQuery.refetch();
                    }}
                />
            ) : (
                <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                    {/* Botões de export do topo */}
                    <View className="mb-4 flex-row gap-3">
                        <ExportButton
                            label="Exportar completo"
                            variant="primary"
                            busy={downloadingKey === 'completo'}
                            disabled={!!downloadingKey || grandCount === 0}
                            onPress={handleExportCompleto}
                        />
                        <ExportButton
                            label="Exportar resumo"
                            variant="outline"
                            busy={downloadingKey === 'resumo'}
                            disabled={!!downloadingKey || grandCount === 0}
                            onPress={handleExportResumo}
                        />
                    </View>

                    {allOrders.length === 0 ? (
                        <EmptyState
                            icon="cash-outline"
                            title="Nenhuma O.S no período"
                            description="Não há ordens verificadas para a loja e o período selecionados."
                        />
                    ) : (
                        <>
                            {groups.map((group) => (
                                <GroupCard
                                    key={group.key}
                                    group={group}
                                    busy={downloadingKey === group.key}
                                    disabled={!!downloadingKey}
                                    onExport={() => handleExportGroup(group)}
                                    canOpenOrder={canConference}
                                    onOpenOrder={openOrder}
                                />
                            ))}

                            {grandCount > 0 ? (
                                <View className="mt-3 flex-row items-center justify-between rounded-2xl border-2 border-brand/40 bg-neutral-100 px-4 py-3.5 dark:bg-dark-elevated">
                                    <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                                        {`TOTAL GERAL — ${grandCount} O.S`}
                                    </Text>
                                    <Text className="font-display-bold text-lg text-brand">
                                        {formatCurrencyBRL(grandTotal)}
                                    </Text>
                                </View>
                            ) : null}
                        </>
                    )}
                </ScrollView>
            )}
        </View>
    );
}

// ─── Header preto com filtros (loja + período) ──────────────────────────────

interface HeaderProps {
    subtitle: string;
    onBack: () => void;
    dateFrom?: string;
    dateTo?: string;
    onChangeFrom?: (v: string) => void;
    onChangeTo?: (v: string) => void;
}

function FechamentoHeader({
    subtitle,
    onBack,
    dateFrom,
    dateTo,
    onChangeFrom,
    onChangeTo,
}: HeaderProps) {
    const showFilters = !!onChangeFrom && !!onChangeTo;
    return (
        <SafeAreaView edges={['top']} className="bg-brand-black">
            <View className="px-4 pb-3 pt-2">
                <View className="flex-row items-center gap-3">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Voltar"
                        onPress={onBack}
                        hitSlop={8}
                        className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
                    >
                        <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                    </Pressable>
                    <View className="flex-1">
                        <Text className="font-display-bold text-xl text-white">Fechamento</Text>
                        {subtitle ? (
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">{subtitle}</Text>
                        ) : null}
                    </View>
                </View>

                {showFilters ? (
                    <View className="mt-3 gap-3 rounded-xl bg-white/5 p-3">
                        <View>
                            <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
                                Loja
                            </Text>
                            <StoreSelector />
                        </View>
                        <View className="flex-row gap-3">
                            <View className="flex-1">
                                <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
                                    De
                                </Text>
                                <TextInput
                                    accessibilityLabel="Data inicial"
                                    placeholder="AAAA-MM-DD"
                                    value={dateFrom}
                                    onChangeText={onChangeFrom}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="numbers-and-punctuation"
                                    placeholderTextColor="#98A2B3"
                                    className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                    style={{ color: '#FFFFFF' }}
                                />
                            </View>
                            <View className="flex-1">
                                <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
                                    Até
                                </Text>
                                <TextInput
                                    accessibilityLabel="Data final"
                                    placeholder="AAAA-MM-DD"
                                    value={dateTo}
                                    onChangeText={onChangeTo}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="numbers-and-punctuation"
                                    placeholderTextColor="#98A2B3"
                                    className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                    style={{ color: '#FFFFFF' }}
                                />
                            </View>
                        </View>
                    </View>
                ) : null}
            </View>
        </SafeAreaView>
    );
}

// ─── Card de grupo ──────────────────────────────────────────────────────────

interface GroupCardProps {
    group: GroupResult;
    busy: boolean;
    disabled: boolean;
    onExport: () => void;
    /** Se `true`, cada linha por carro ganha o botão "Visualizar" (acesso à Conferência). */
    canOpenOrder: boolean;
    onOpenOrder: (id: number) => void;
}

function GroupCard({ group, busy, disabled, onExport, canOpenOrder, onOpenOrder }: GroupCardProps) {
    const [expanded, setExpanded] = useState(false);
    const hasOrders = group.orders.length > 0;

    return (
        <View className="mb-2.5 rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-center p-4">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        hasOrders
                            ? `${expanded ? 'Recolher' : 'Expandir'} ${group.label}`
                            : group.label
                    }
                    accessibilityState={{ expanded }}
                    disabled={!hasOrders}
                    onPress={() => setExpanded((v) => !v)}
                    className="flex-1 flex-row items-center pr-3 active:opacity-70"
                >
                    <View className="flex-1">
                        <Text
                            className="font-sans-bold text-base text-neutral-900 dark:text-dark-text"
                            numberOfLines={1}
                        >
                            {group.label}
                        </Text>
                        <View className="mt-1 flex-row items-center gap-2">
                            <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                {`${group.count} ${group.count === 1 ? 'O.S' : 'O.S'}`}
                            </Text>
                            <View className="h-1 w-1 rounded-full bg-neutral-300 dark:bg-dark-border-soft" />
                            <Text className="font-sans-semibold text-sm text-brand">
                                {formatCurrencyBRL(group.total)}
                            </Text>
                        </View>
                    </View>
                    {hasOrders ? (
                        <Ionicons
                            name={expanded ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color="#98A2B3"
                        />
                    ) : null}
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Exportar ${group.label}`}
                    accessibilityState={{ busy, disabled }}
                    disabled={disabled}
                    onPress={onExport}
                    className={`ml-2 h-11 w-11 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated ${
                        disabled && !busy ? 'opacity-40' : ''
                    }`}
                >
                    {busy ? (
                        <ActivityIndicator color="#667085" />
                    ) : (
                        <Ionicons name="download-outline" size={20} color="#667085" />
                    )}
                </Pressable>
            </View>

            {expanded && hasOrders ? (
                <View className="border-t border-neutral-100 dark:border-dark-border-soft">
                    {group.orders.map((row, i) => (
                        <OrderRow
                            key={`${row.order.id}-${i}`}
                            row={row}
                            canOpen={canOpenOrder}
                            onOpen={() => onOpenOrder(row.order.id)}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

// ─── Linha por carro (dentro de um card expandido) ──────────────────────────

interface OrderRowProps {
    row: GroupOrderRow;
    canOpen: boolean;
    onOpen: () => void;
}

function OrderRow({ row, canOpen, onOpen }: OrderRowProps) {
    const { order, total } = row;
    const osNumber = order.external_os_number ?? '—';
    return (
        <View className="flex-row items-center border-b border-neutral-50 px-4 py-3 dark:border-dark-border-soft">
            <View className="flex-1 pr-3">
                <Text
                    className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                    numberOfLines={1}
                >
                    {order.plate}
                </Text>
                <View className="mt-0.5 flex-row items-center gap-2">
                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        {`OS ${osNumber}`}
                    </Text>
                    <View className="h-1 w-1 rounded-full bg-neutral-300 dark:bg-dark-border-soft" />
                    <Text className="font-sans-medium text-xs text-brand">
                        {formatCurrencyBRL(total)}
                    </Text>
                </View>
            </View>
            {canOpen ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Visualizar O.S. ${order.plate}`}
                    onPress={onOpen}
                    hitSlop={8}
                    className="h-10 w-10 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated"
                >
                    <Ionicons name="eye-outline" size={18} color="#667085" />
                </Pressable>
            ) : null}
        </View>
    );
}

// ─── Botão de export do topo ────────────────────────────────────────────────

interface ExportButtonProps {
    label: string;
    variant: 'primary' | 'outline';
    busy: boolean;
    disabled: boolean;
    onPress: () => void;
}

function ExportButton({ label, variant, busy, disabled, onPress }: ExportButtonProps) {
    const isPrimary = variant === 'primary';
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ busy, disabled }}
            disabled={disabled}
            onPress={onPress}
            className={`min-h-[44px] flex-1 flex-row items-center justify-center gap-2 rounded-xl px-3 py-2.5 active:opacity-80 ${
                isPrimary ? 'bg-brand' : 'border border-brand bg-transparent'
            } ${disabled ? 'opacity-50' : ''}`}
        >
            {busy ? (
                <ActivityIndicator color={isPrimary ? '#1A1A1A' : '#F5B800'} />
            ) : (
                <Ionicons
                    name="download-outline"
                    size={18}
                    color={isPrimary ? '#1A1A1A' : '#F5B800'}
                />
            )}
            <Text
                className={`font-sans-bold text-sm ${
                    isPrimary ? 'text-brand-black' : 'text-brand'
                }`}
            >
                {label}
            </Text>
        </Pressable>
    );
}

function ListSkeleton() {
    return (
        <View className="p-4">
            <View className="mb-4 flex-row gap-3">
                <Skeleton width="48%" height={44} radius={12} />
                <Skeleton width="48%" height={44} radius={12} />
            </View>
            {[0, 1, 2, 3].map((i) => (
                <View
                    key={i}
                    className="mb-2.5 flex-row items-center justify-between rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <View>
                        <Skeleton width={120} height={16} />
                        <Skeleton width={80} height={12} className="mt-2" />
                    </View>
                    <Skeleton width={44} height={44} radius={22} />
                </View>
            ))}
        </View>
    );
}
