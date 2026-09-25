import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { StoreSelector } from '@/components/common/StoreSelector';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import {
    useInstallerDaily,
    useInstallerIndividual,
    useInstallerSummary,
    useInstallerReturns,
} from '@/hooks/useInstallerPerformance';
import { employeesService } from '@/services/api/employees.service';
import { useStoreStore } from '@/stores/store.store';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatCurrencyBRL, formatInt } from '@/utils/formatNumber';
import { FILM_INSTALLER_POSITION } from '@/constants/employees';
import type {
    DailyInstallerGroup,
    IndividualServiceRow,
    IndividualFilters,
    SummaryFilters,
    SummaryRankingRow,
    ReturnRow,
    ReturnsFilters,
} from '@/services/api/installer-performance.service';
import type { Employee } from '@/types/employee.types';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * Desempenho de Instaladores — paridade com o web (`InstallerDailyPage` +
 * `InstallerIndividualPage` + `InstallerSummaryPage` + `InstallerReturnsPage`),
 * unificado numa tela com segmented control "Diário"/"Individual"/"Resumo"/
 * "Retornos".
 *
 * - Diário: filtros data (default hoje) + loja (StoreSelector) + instaladores
 *   (multi-select opcional). Lista agrupada por instalador (card com
 *   total_cars/total_revenue e veículos) + total geral. Export PDF.
 * - Individual: período (start/end) + instalador (obrigatório). NÃO usa o
 *   seletor de loja global (o relatório é pessoal e cruza lojas). Resumo
 *   (carros/serviços/pontos/receita) + linhas com pontos. Export PDF.
 * - Resumo: período + loja (StoreSelector). 5 KPIs (carros/serviços/pontos/
 *   faturamento/custo de películas) + ranking ordenável (pontos/faturamento/
 *   carros/serviços/O.S.). Export PDF.
 * - Retornos: período + loja (StoreSelector). Cada retorno vira um card com 3
 *   blocos (Retorno / Anterior / Veículo) — legível em tela estreita (o web usa
 *   tabela de 11 colunas). Sem export no mobile (o web também não exporta).
 *
 * Gate: submódulo `installer_performance` (mesmo do web) — aplicado no MoreScreen.
 * Header próprio (preto); o AppStack usa `headerShown: false`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "AAAA-MM-DD" a partir da data LOCAL (evita o -1 dia de toISOString em UTC-3). */
function todayLocal(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function firstDayOfMonthLocal(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" sem criar Date (não desloca fuso). */
function formatDateBR(iso: string): string {
    const [y, m, d] = iso.substring(0, 10).split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Total de serviços do individual: inteiro exato ou 1 casa (pt-BR). */
function formatServices(total: number): string {
    if (Number.isInteger(total)) return String(total);
    return total.toFixed(2).replace(/0$/, '').replace('.', ',');
}

/** Serviços fracionados no ranking: até 2 casas, sem zeros à direita (pt-BR). */
function formatServicesCount(total: number): string {
    return total.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Pontos sempre com 2 casas (pt-BR), espelhando o web. */
function formatPoints(value: number): string {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type TabKey = 'daily' | 'individual' | 'summary' | 'returns';

export function InstallerPerformanceScreen({
    navigation,
}: AppStackScreenProps<'InstallerPerformance'>) {
    const [tab, setTab] = useState<TabKey>('daily');

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto + segmented control */}
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-4 pb-3 pt-2">
                    <View className="flex-row items-center gap-3">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Voltar"
                            onPress={() => navigation.goBack()}
                            hitSlop={8}
                            className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
                        >
                            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                        </Pressable>
                        <View className="flex-1">
                            <Text className="font-display-bold text-xl text-white">
                                Desempenho
                            </Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">
                                Produção de instaladores
                            </Text>
                        </View>
                    </View>

                    {/* Segmented control Diário / Individual / Resumo / Retornos.
                        4 abas não cabem numa linha em tela estreita → grid 2×2. */}
                    <View className="mt-3 rounded-xl bg-white/10 p-1">
                        <View className="flex-row">
                            <SegTab
                                label="Diário"
                                active={tab === 'daily'}
                                onPress={() => setTab('daily')}
                            />
                            <SegTab
                                label="Individual"
                                active={tab === 'individual'}
                                onPress={() => setTab('individual')}
                            />
                        </View>
                        <View className="mt-1 flex-row">
                            <SegTab
                                label="Resumo"
                                active={tab === 'summary'}
                                onPress={() => setTab('summary')}
                            />
                            <SegTab
                                label="Retornos"
                                active={tab === 'returns'}
                                onPress={() => setTab('returns')}
                            />
                        </View>
                    </View>
                </View>
            </SafeAreaView>

            {tab === 'daily' ? (
                <DailyView navigation={navigation} />
            ) : tab === 'individual' ? (
                <IndividualView />
            ) : tab === 'summary' ? (
                <SummaryView />
            ) : (
                <ReturnsView navigation={navigation} />
            )}
        </View>
    );
}

function SegTab({
    label,
    active,
    onPress,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            onPress={onPress}
            className={`flex-1 items-center rounded-lg py-2 active:opacity-80 ${
                active ? 'bg-brand' : ''
            }`}
        >
            <Text
                className={`font-sans-semibold text-sm ${
                    active ? 'text-brand-black' : 'text-neutral-300'
                }`}
            >
                {label}
            </Text>
        </Pressable>
    );
}

// ─── Instaladores (compartilhado pelas duas visões) ──────────────────────────

function useFilmInstallers() {
    return useQuery({
        queryKey: ['employees', 'installers-all-stores'],
        queryFn: () =>
            employeesService
                .list({ position: FILM_INSTALLER_POSITION, is_active: true }, 1, 500)
                .then((r) => r.employees),
        staleTime: 1000 * 60 * 10,
    });
}

// ─── Visão Diária ────────────────────────────────────────────────────────────

function DailyView({
    navigation,
}: {
    navigation: AppStackScreenProps<'InstallerPerformance'>['navigation'];
}) {
    const toast = useToast();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [date, setDate] = useState<string>(todayLocal());
    const [selectedInstallerIds, setSelectedInstallerIds] = useState<number[]>([]);
    const [exporting, setExporting] = useState(false);

    const installerSheetRef = useRef<SelectRef>(null);
    const { data: installers = [], isLoading: loadingInstallers } = useFilmInstallers();

    const validDate = DATE_RE.test(date) ? date : undefined;

    const filters = useMemo(
        () => ({
            date: validDate ?? '',
            store_id: selectedStoreId ?? undefined,
            employee_ids: selectedInstallerIds.length > 0 ? selectedInstallerIds : undefined,
        }),
        [validDate, selectedStoreId, selectedInstallerIds]
    );

    const { data, isLoading, isError, refetch, isRefetching } = useInstallerDaily(filters);

    const installerOptions = useMemo<SelectOption<number>[]>(
        () =>
            [...installers]
                .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                .map((e: Employee) => ({
                    value: e.id,
                    label: e.store_name ? `${e.name} — ${e.store_name}` : e.name,
                })),
        [installers]
    );

    const installerLabel =
        selectedInstallerIds.length === 0
            ? 'Todos os instaladores'
            : selectedInstallerIds.length === 1
              ? (installers.find((e) => e.id === selectedInstallerIds[0])?.name ?? '1 selecionado')
              : `${selectedInstallerIds.length} selecionados`;

    const handleExport = useCallback(async () => {
        if (exporting || !validDate) return;
        setExporting(true);
        try {
            await downloadAndSharePdf({
                path: '/installer-performance/export/daily',
                params: {
                    date: validDate,
                    store_id: selectedStoreId ?? undefined,
                    employee_ids:
                        selectedInstallerIds.length > 0 ? selectedInstallerIds : undefined,
                },
                filename: `desempenho_instaladores_${validDate}.pdf`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, validDate, selectedStoreId, selectedInstallerIds, toast]);

    return (
        <>
            {/* Filtros */}
            <View className="bg-brand-black px-4 pb-3">
                <View className="gap-3 rounded-xl bg-white/5 p-3">
                    <View className="flex-row items-end gap-3">
                        <View className="flex-1">
                            <FilterLabel>Loja</FilterLabel>
                            <StoreSelector />
                        </View>
                        <View className="w-[150px]">
                            <FilterLabel>Data</FilterLabel>
                            <TextInput
                                accessibilityLabel="Data"
                                placeholder="AAAA-MM-DD"
                                value={date}
                                onChangeText={setDate}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                placeholderTextColor="#98A2B3"
                                className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                style={{ color: '#FFFFFF' }}
                            />
                        </View>
                    </View>

                    <View>
                        <FilterLabel>Instalador</FilterLabel>
                        <DarkPicker
                            value={loadingInstallers ? 'Carregando...' : installerLabel}
                            onPress={() => installerSheetRef.current?.present()}
                        />
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Exportar relatório diário em PDF"
                        accessibilityState={{ busy: exporting, disabled: exporting || isLoading }}
                        disabled={exporting || isLoading}
                        onPress={() => void handleExport()}
                        className={`min-h-[44px] flex-row items-center justify-center gap-2 rounded-lg bg-brand px-4 active:opacity-90 ${
                            exporting || isLoading ? 'opacity-50' : ''
                        }`}
                    >
                        {exporting ? (
                            <ActivityIndicator color="#1A1A1A" />
                        ) : (
                            <Ionicons name="document-text-outline" size={18} color="#1A1A1A" />
                        )}
                        <Text className="font-sans-bold text-sm text-brand-black">
                            {exporting ? 'Gerando PDF...' : 'Exportar PDF'}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Conteúdo */}
            {isLoading ? (
                <GroupsSkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : !data || data.groups.length === 0 ? (
                <EmptyState
                    icon="car-outline"
                    title="Nenhum carro finalizado no dia"
                    description="Selecione outra data ou ajuste os filtros."
                />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {/* Total do dia */}
                    <View className="mb-4 flex-row items-center gap-4 rounded-2xl border border-neutral-100 bg-white px-4 py-3 dark:border-dark-border-soft dark:bg-dark-surface">
                        <Text className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                            Total do dia
                        </Text>
                        <View className="flex-row items-center gap-1">
                            <Ionicons name="car-sport-outline" size={16} color="#D47F00" />
                            <Text className="font-sans-semibold text-sm text-neutral-900 dark:text-dark-text">
                                {formatInt(data.grand_total_cars)}{' '}
                                {data.grand_total_cars === 1 ? 'carro' : 'carros'}
                            </Text>
                        </View>
                        <Text className="ml-auto font-display-bold text-base text-neutral-900 dark:text-dark-text">
                            {formatCurrencyBRL(data.grand_total_revenue)}
                        </Text>
                    </View>

                    <View className="gap-4">
                        {data.groups.map((group) => (
                            <InstallerGroupCard
                                key={group.employee_id}
                                group={group}
                                onOpenOS={(osId) =>
                                    navigation.navigate('Tabs', {
                                        screen: 'ServiceOrders',
                                        params: {
                                            screen: 'ServiceOrderDetail',
                                            params: { id: osId },
                                        },
                                    })
                                }
                            />
                        ))}
                    </View>
                </ScrollView>
            )}

            {/* Sheet: multi-seleção de instaladores */}
            <Select<number>
                ref={installerSheetRef}
                title="Filtrar por instalador"
                multiple
                options={installerOptions}
                value={selectedInstallerIds}
                onChange={setSelectedInstallerIds}
            />
        </>
    );
}

function InstallerGroupCard({
    group,
    onOpenOS,
}: {
    group: DailyInstallerGroup;
    onOpenOS: (osId: number) => void;
}) {
    return (
        <View className="overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
            {/* Cabeçalho do instalador */}
            <View className="flex-row items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-dark-border-soft dark:bg-dark-elevated">
                <View className="flex-1 flex-row items-center gap-2">
                    <Ionicons name="speedometer-outline" size={16} color="#D47F00" />
                    <Text
                        className="flex-1 font-sans-semibold text-sm text-neutral-900 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {group.employee_name}
                    </Text>
                </View>
                <View className="flex-row items-center gap-3">
                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        {formatInt(group.total_cars)}{' '}
                        {group.total_cars === 1 ? 'carro' : 'carros'}
                    </Text>
                    <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                        {formatCurrencyBRL(group.total_revenue)}
                    </Text>
                </View>
            </View>

            {/* Veículos */}
            {group.vehicles.length === 0 ? (
                <Text className="px-4 py-3 font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                    Nenhum veículo no dia.
                </Text>
            ) : (
                <View>
                    {group.vehicles.map((row, idx) => {
                        const osLabel =
                            row.external_os_number ?? row.order_number ?? `#${row.os_id}`;
                        return (
                            <Pressable
                                key={`${row.os_id}-${idx}`}
                                accessibilityRole="button"
                                accessibilityLabel={`O.S. ${osLabel} — ${row.plate}`}
                                onPress={() => onOpenOS(row.os_id)}
                                className="border-b border-neutral-50 px-4 py-3 active:bg-neutral-50 dark:border-dark-border-soft dark:active:bg-dark-elevated"
                            >
                                <View className="flex-row items-center justify-between gap-2">
                                    <Text className="font-sans-semibold text-sm text-neutral-900 dark:text-dark-text">
                                        {row.plate}
                                    </Text>
                                    {row.is_courtesy ? (
                                        <Badge label="Cortesia" variant="warning" size="sm" />
                                    ) : (
                                        <Text className="font-sans-semibold text-sm text-neutral-900 dark:text-dark-text">
                                            {formatCurrencyBRL(row.value)}
                                        </Text>
                                    )}
                                </View>
                                <Text
                                    className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted"
                                    numberOfLines={1}
                                >
                                    {osLabel}
                                    {row.vehicle ? ` · ${row.vehicle}` : ''}
                                    {row.store_name ? ` · ${row.store_name}` : ''}
                                </Text>
                                {row.services.length > 0 || row.has_shared ? (
                                    <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
                                        {row.services.length > 0 ? (
                                            <Text
                                                className="font-sans text-xs text-neutral-600 dark:text-dark-text-muted"
                                                numberOfLines={2}
                                            >
                                                {row.services.join(' + ')}
                                            </Text>
                                        ) : null}
                                        {row.has_shared ? (
                                            <Badge label="Dividido" variant="info" size="sm" />
                                        ) : null}
                                    </View>
                                ) : null}
                            </Pressable>
                        );
                    })}
                </View>
            )}
        </View>
    );
}

// ─── Visão Individual ────────────────────────────────────────────────────────

function IndividualView() {
    const toast = useToast();

    // Relatório pessoal: NÃO usa o seletor de loja global (o instalador pode
    // atuar em várias lojas), espelhando o web.
    const [start, setStart] = useState<string>(firstDayOfMonthLocal());
    const [end, setEnd] = useState<string>(todayLocal());
    const [employeeId, setEmployeeId] = useState<number | null>(null);
    const [exporting, setExporting] = useState(false);

    const employeeSheetRef = useRef<SelectRef>(null);
    const { data: installers = [], isLoading: loadingInstallers } = useFilmInstallers();

    const validStart = DATE_RE.test(start) ? start : undefined;
    const validEnd = DATE_RE.test(end) ? end : undefined;

    const filters = useMemo<IndividualFilters | null>(
        () =>
            employeeId !== null && validStart && validEnd
                ? { start: validStart, end: validEnd, employee_id: employeeId }
                : null,
        [employeeId, validStart, validEnd]
    );

    const { data, isLoading, isError, refetch, isRefetching } = useInstallerIndividual(filters);

    const employeeOptions = useMemo<SelectOption<number>[]>(
        () =>
            [...installers]
                .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                .map((e: Employee) => ({
                    value: e.id,
                    label: e.store_name ? `${e.name} — ${e.store_name}` : e.name,
                })),
        [installers]
    );

    const selectedName = installers.find((e) => e.id === employeeId)?.name;

    const handleExport = useCallback(async () => {
        if (exporting || !filters) return;
        setExporting(true);
        try {
            await downloadAndSharePdf({
                path: '/installer-performance/export/individual',
                params: {
                    start: filters.start,
                    end: filters.end,
                    employee_id: filters.employee_id,
                },
                filename: `desempenho_instalador_${filters.employee_id}_${filters.start}_${filters.end}.pdf`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, filters, toast]);

    return (
        <>
            {/* Filtros */}
            <View className="bg-brand-black px-4 pb-3">
                <View className="gap-3 rounded-xl bg-white/5 p-3">
                    <View className="flex-row gap-3">
                        <View className="flex-1">
                            <FilterLabel>Início</FilterLabel>
                            <TextInput
                                accessibilityLabel="Data inicial"
                                placeholder="AAAA-MM-DD"
                                value={start}
                                onChangeText={setStart}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                placeholderTextColor="#98A2B3"
                                className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                style={{ color: '#FFFFFF' }}
                            />
                        </View>
                        <View className="flex-1">
                            <FilterLabel>Fim</FilterLabel>
                            <TextInput
                                accessibilityLabel="Data final"
                                placeholder="AAAA-MM-DD"
                                value={end}
                                onChangeText={setEnd}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="numbers-and-punctuation"
                                placeholderTextColor="#98A2B3"
                                className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
                                style={{ color: '#FFFFFF' }}
                            />
                        </View>
                    </View>

                    <View>
                        <FilterLabel>Instalador *</FilterLabel>
                        <DarkPicker
                            value={
                                loadingInstallers
                                    ? 'Carregando...'
                                    : (selectedName ?? 'Selecione um instalador')
                            }
                            onPress={() => employeeSheetRef.current?.present()}
                        />
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Gerar PDF do instalador"
                        accessibilityState={{
                            busy: exporting,
                            disabled: exporting || isLoading || !employeeId,
                        }}
                        disabled={exporting || isLoading || !employeeId}
                        onPress={() => void handleExport()}
                        className={`min-h-[44px] flex-row items-center justify-center gap-2 rounded-lg bg-brand px-4 active:opacity-90 ${
                            exporting || isLoading || !employeeId ? 'opacity-50' : ''
                        }`}
                    >
                        {exporting ? (
                            <ActivityIndicator color="#1A1A1A" />
                        ) : (
                            <Ionicons name="document-text-outline" size={18} color="#1A1A1A" />
                        )}
                        <Text className="font-sans-bold text-sm text-brand-black">
                            {exporting ? 'Gerando PDF...' : 'Gerar PDF do Instalador'}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Conteúdo */}
            {!employeeId ? (
                <EmptyState
                    icon="person-outline"
                    title="Selecione um instalador"
                    description="Use o seletor acima para escolher o instalador desejado."
                />
            ) : isLoading ? (
                <IndividualSkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : !data ? null : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {/* Resumo */}
                    <View className="mb-3 flex-row gap-3">
                        <SummaryTile
                            label="Carros"
                            value={formatInt(data.total_cars)}
                            note={`${formatServices(data.total_services)} ${
                                data.total_services === 1 ? 'serviço' : 'serviços'
                            }`}
                        />
                        <SummaryTile label="Pontos" value={formatPoints(data.total_points)} />
                    </View>
                    <View className="mb-3">
                        <SummaryTile
                            label="Faturamento"
                            value={formatCurrencyBRL(data.total_revenue)}
                        />
                    </View>

                    {/* Cabeçalho do resultado */}
                    <Text className="mb-3 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        <Text className="font-sans-semibold text-neutral-800 dark:text-dark-text">
                            {data.employee_name}
                        </Text>
                        {'  ·  '}
                        {formatDateBR(data.period_start)} a {formatDateBR(data.period_end)}
                        {data.store_name ? `  ·  ${data.store_name}` : ''}
                    </Text>

                    {/* Linhas */}
                    {data.rows.length === 0 ? (
                        <EmptyState
                            icon="car-outline"
                            title="Nenhum serviço no período"
                            description="Ajuste o período selecionado."
                        />
                    ) : (
                        <View className="overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
                            {data.rows.map((row, idx) => (
                                <IndividualRow key={`${row.os_id}-${idx}`} row={row} />
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}

            {/* Sheet: seleção única de instalador */}
            <Select<number>
                ref={employeeSheetRef}
                title="Selecionar instalador"
                options={employeeOptions}
                value={employeeId}
                onChange={setEmployeeId}
            />
        </>
    );
}

function IndividualRow({ row }: { row: IndividualServiceRow }) {
    const osLabel = row.external_os_number ?? row.order_number ?? `#${row.os_id}`;
    return (
        <View className="border-b border-neutral-50 px-4 py-3 dark:border-dark-border-soft">
            <View className="flex-row items-center justify-between gap-2">
                <Text className="font-sans-semibold text-sm text-neutral-900 dark:text-dark-text">
                    {row.plate}
                </Text>
                <View className="flex-row items-center gap-2">
                    <View className="flex-row items-center gap-1">
                        <Ionicons name="star" size={12} color="#D47F00" />
                        <Text className="font-sans-semibold text-xs text-neutral-600 dark:text-dark-text-muted">
                            {formatPoints(row.points)}
                        </Text>
                    </View>
                    <Text className="font-sans-semibold text-sm text-neutral-900 dark:text-dark-text">
                        {formatCurrencyBRL(row.value)}
                    </Text>
                </View>
            </View>
            <Text
                className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted"
                numberOfLines={1}
            >
                {formatDateBR(row.completion_date)} · {osLabel}
                {row.vehicle ? ` · ${row.vehicle}` : ''}
                {row.store_name ? ` · ${row.store_name}` : ''}
            </Text>
            {row.services.length > 0 ? (
                <Text
                    className="mt-1 font-sans text-xs text-neutral-600 dark:text-dark-text-muted"
                    numberOfLines={2}
                >
                    {row.services.join(' + ')}
                </Text>
            ) : null}
            {row.is_return || row.is_courtesy || row.has_shared ? (
                <View className="mt-1.5 flex-row flex-wrap gap-1.5">
                    {row.is_return ? <Badge label="Retorno" variant="info" size="sm" /> : null}
                    {row.is_courtesy ? <Badge label="Cortesia" variant="warning" size="sm" /> : null}
                    {row.has_shared ? <Badge label="Dividido" variant="info" size="sm" /> : null}
                </View>
            ) : null}
        </View>
    );
}

// ─── Visão Resumo ────────────────────────────────────────────────────────────

type SummarySortKey = 'employee_name' | 'orders_count' | 'services_count' | 'cars_count' | 'points' | 'revenue';

/** Opções de ordenação do ranking (o mobile usa um sheet no lugar dos cabeçalhos clicáveis do web). */
const SUMMARY_SORT_OPTIONS: SelectOption<SummarySortKey>[] = [
    { value: 'points', label: 'Pontos (maior primeiro)' },
    { value: 'revenue', label: 'Faturamento (maior primeiro)' },
    { value: 'cars_count', label: 'Carros (maior primeiro)' },
    { value: 'services_count', label: 'Serviços (maior primeiro)' },
    { value: 'orders_count', label: 'O.S. (maior primeiro)' },
    { value: 'employee_name', label: 'Nome (A–Z)' },
];

function SummaryView() {
    const toast = useToast();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [start, setStart] = useState<string>(firstDayOfMonthLocal());
    const [end, setEnd] = useState<string>(todayLocal());
    const [sortKey, setSortKey] = useState<SummarySortKey>('points');
    const [exporting, setExporting] = useState(false);

    const sortSheetRef = useRef<SelectRef>(null);

    const validStart = DATE_RE.test(start) ? start : undefined;
    const validEnd = DATE_RE.test(end) ? end : undefined;

    const filters = useMemo<SummaryFilters>(
        () => ({
            start: validStart ?? '',
            end: validEnd ?? '',
            store_id: selectedStoreId ?? undefined,
        }),
        [validStart, validEnd, selectedStoreId]
    );

    const { data, isLoading, isError, refetch, isRefetching } = useInstallerSummary(filters);

    // Ordenação client-side (o backend devolve as linhas; o web também ordena no cliente).
    const sortedRows = useMemo<SummaryRankingRow[]>(() => {
        if (!data) return [];
        const rows = [...data.rows];
        rows.sort((a, b) => {
            if (sortKey === 'employee_name') {
                return a.employee_name.localeCompare(b.employee_name, 'pt-BR');
            }
            return (b[sortKey] as number) - (a[sortKey] as number);
        });
        return rows;
    }, [data, sortKey]);

    const sortLabel =
        SUMMARY_SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? 'Ordenar';

    const handleExport = useCallback(async () => {
        if (exporting || !validStart || !validEnd) return;
        setExporting(true);
        try {
            await downloadAndSharePdf({
                path: '/installer-performance/export/summary',
                params: {
                    start: validStart,
                    end: validEnd,
                    store_id: selectedStoreId ?? undefined,
                },
                filename: `resumo_instaladores_${validStart}_${validEnd}.pdf`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, validStart, validEnd, selectedStoreId, toast]);

    return (
        <>
            {/* Filtros */}
            <View className="bg-brand-black px-4 pb-3">
                <View className="gap-3 rounded-xl bg-white/5 p-3">
                    <View>
                        <FilterLabel>Loja</FilterLabel>
                        <StoreSelector />
                    </View>
                    <View className="flex-row gap-3">
                        <View className="flex-1">
                            <FilterLabel>Início</FilterLabel>
                            <DateField
                                label="Data inicial (resumo)"
                                value={start}
                                onChangeText={setStart}
                            />
                        </View>
                        <View className="flex-1">
                            <FilterLabel>Fim</FilterLabel>
                            <DateField
                                label="Data final (resumo)"
                                value={end}
                                onChangeText={setEnd}
                            />
                        </View>
                    </View>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Gerar PDF do resumo"
                        accessibilityState={{ busy: exporting, disabled: exporting || isLoading }}
                        disabled={exporting || isLoading}
                        onPress={() => void handleExport()}
                        className={`min-h-[44px] flex-row items-center justify-center gap-2 rounded-lg bg-brand px-4 active:opacity-90 ${
                            exporting || isLoading ? 'opacity-50' : ''
                        }`}
                    >
                        {exporting ? (
                            <ActivityIndicator color="#1A1A1A" />
                        ) : (
                            <Ionicons name="document-text-outline" size={18} color="#1A1A1A" />
                        )}
                        <Text className="font-sans-bold text-sm text-brand-black">
                            {exporting ? 'Gerando PDF...' : 'Gerar PDF do Resumo'}
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Conteúdo */}
            {isLoading ? (
                <SummarySkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : !data ? null : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {/* Cabeçalho do período */}
                    <Text className="mb-3 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        {formatDateBR(data.period_start)} a {formatDateBR(data.period_end)}
                        {data.store_name ? `  ·  ${data.store_name}` : ''}
                    </Text>

                    {/* 5 KPIs */}
                    <View className="mb-4 flex-row flex-wrap gap-3">
                        <KpiTile
                            icon="car-sport-outline"
                            label="Total de Carros"
                            value={formatInt(data.totals.total_cars)}
                        />
                        <KpiTile
                            icon="layers-outline"
                            label="Total de Serviços"
                            value={formatServicesCount(data.totals.total_services)}
                        />
                        <KpiTile
                            icon="star-outline"
                            label="Pontos"
                            value={formatPoints(data.totals.total_points)}
                        />
                        <KpiTile
                            icon="cash-outline"
                            label="Faturamento"
                            value={formatCurrencyBRL(data.totals.total_revenue)}
                        />
                        <KpiTile
                            icon="pricetag-outline"
                            label="Custo de Películas"
                            value={formatCurrencyBRL(data.totals.film_cost)}
                        />
                    </View>

                    {/* Ranking */}
                    {data.rows.length === 0 ? (
                        <EmptyState
                            icon="car-outline"
                            title="Nenhum serviço no período"
                            description="Ajuste o período ou a loja selecionada."
                        />
                    ) : (
                        <>
                            <View className="mb-2 flex-row items-center justify-between">
                                <Text className="font-sans-semibold text-sm text-neutral-900 dark:text-dark-text">
                                    Ranking
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Ordenar ranking: ${sortLabel}`}
                                    onPress={() => sortSheetRef.current?.present()}
                                    hitSlop={8}
                                    className="flex-row items-center gap-1 rounded-lg bg-neutral-100 px-3 py-1.5 active:opacity-70 dark:bg-dark-elevated"
                                >
                                    <Ionicons name="swap-vertical" size={14} color="#D47F00" />
                                    <Text className="font-sans-medium text-xs text-neutral-700 dark:text-dark-text">
                                        Ordenar
                                    </Text>
                                </Pressable>
                            </View>

                            <View className="gap-3">
                                {sortedRows.map((row, idx) => (
                                    <SummaryRankingCard
                                        key={row.employee_id}
                                        rank={idx + 1}
                                        row={row}
                                        highlight={sortKey}
                                    />
                                ))}
                            </View>
                        </>
                    )}
                </ScrollView>
            )}

            {/* Sheet: ordenação do ranking */}
            <Select<SummarySortKey>
                ref={sortSheetRef}
                title="Ordenar ranking por"
                options={SUMMARY_SORT_OPTIONS}
                value={sortKey}
                onChange={setSortKey}
            />
        </>
    );
}

function SummaryRankingCard({
    rank,
    row,
    highlight,
}: {
    rank: number;
    row: SummaryRankingRow;
    highlight: SummarySortKey;
}) {
    return (
        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-center gap-3">
                <View className="h-7 w-7 items-center justify-center rounded-full bg-neutral-100 dark:bg-dark-elevated">
                    <Text className="font-sans-bold text-xs text-neutral-700 dark:text-dark-text">
                        {rank}
                    </Text>
                </View>
                <Text
                    className="flex-1 font-sans-semibold text-sm text-neutral-900 dark:text-dark-text"
                    numberOfLines={1}
                >
                    {row.employee_name}
                </Text>
                <Text className="font-display-bold text-sm text-neutral-900 dark:text-dark-text">
                    {formatCurrencyBRL(row.revenue)}
                </Text>
            </View>

            {/* Métricas: chips que destacam a coluna de ordenação vigente. */}
            <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-1.5">
                <RankingMetric
                    label="Pontos"
                    value={formatPoints(row.points)}
                    active={highlight === 'points'}
                />
                <RankingMetric
                    label="Carros"
                    value={formatInt(row.cars_count)}
                    active={highlight === 'cars_count'}
                />
                <RankingMetric
                    label="Serviços"
                    value={formatServicesCount(row.services_count)}
                    active={highlight === 'services_count'}
                />
                <RankingMetric
                    label="O.S."
                    value={formatInt(row.orders_count)}
                    active={highlight === 'orders_count'}
                />
            </View>
        </View>
    );
}

function RankingMetric({
    label,
    value,
    active,
}: {
    label: string;
    value: string;
    active: boolean;
}) {
    return (
        <View className="flex-row items-baseline gap-1">
            <Text
                className={`font-sans-bold text-sm ${
                    active
                        ? 'text-brand'
                        : 'text-neutral-900 dark:text-dark-text'
                }`}
            >
                {value}
            </Text>
            <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
        </View>
    );
}

// ─── Visão Retornos ──────────────────────────────────────────────────────────

function ReturnsView({
    navigation,
}: {
    navigation: AppStackScreenProps<'InstallerPerformance'>['navigation'];
}) {
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const [start, setStart] = useState<string>(firstDayOfMonthLocal());
    const [end, setEnd] = useState<string>(todayLocal());

    const validStart = DATE_RE.test(start) ? start : undefined;
    const validEnd = DATE_RE.test(end) ? end : undefined;

    const filters = useMemo<ReturnsFilters>(
        () => ({
            start: validStart ?? '',
            end: validEnd ?? '',
            store_id: selectedStoreId ?? undefined,
        }),
        [validStart, validEnd, selectedStoreId]
    );

    const { data, isLoading, isError, refetch, isRefetching } = useInstallerReturns(filters);

    const openOS = useCallback(
        (osId: number) =>
            navigation.navigate('Tabs', {
                screen: 'ServiceOrders',
                params: { screen: 'ServiceOrderDetail', params: { id: osId } },
            }),
        [navigation]
    );

    return (
        <>
            {/* Filtros */}
            <View className="bg-brand-black px-4 pb-3">
                <View className="gap-3 rounded-xl bg-white/5 p-3">
                    <View>
                        <FilterLabel>Loja</FilterLabel>
                        <StoreSelector />
                    </View>
                    <View className="flex-row gap-3">
                        <View className="flex-1">
                            <FilterLabel>Início</FilterLabel>
                            <DateField
                                label="Data inicial (retornos)"
                                value={start}
                                onChangeText={setStart}
                            />
                        </View>
                        <View className="flex-1">
                            <FilterLabel>Fim</FilterLabel>
                            <DateField
                                label="Data final (retornos)"
                                value={end}
                                onChangeText={setEnd}
                            />
                        </View>
                    </View>
                </View>
            </View>

            {/* Conteúdo */}
            {isLoading ? (
                <GroupsSkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : !data || data.rows.length === 0 ? (
                <EmptyState
                    icon="refresh-outline"
                    title="Nenhum retorno no período"
                    description="Ajuste o período ou a loja selecionada."
                />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    <Text className="mb-3 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        {formatDateBR(data.period_start)} a {formatDateBR(data.period_end)}
                        {data.store_name ? `  ·  ${data.store_name}` : ''}
                        {`  ·  ${data.rows.length} retorno${data.rows.length !== 1 ? 's' : ''}`}
                    </Text>

                    <View className="gap-4">
                        {data.rows.map((row) => (
                            <ReturnCard key={row.return_os_id} row={row} onOpenOS={openOS} />
                        ))}
                    </View>
                </ScrollView>
            )}
        </>
    );
}

function ReturnCard({
    row,
    onOpenOS,
}: {
    row: ReturnRow;
    onOpenOS: (osId: number) => void;
}) {
    const vehicleParts = [row.model, row.chassis, row.color].filter(Boolean) as string[];
    return (
        <View className="overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
            {/* Cabeçalho: veículo */}
            <View className="border-b border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-dark-border-soft dark:bg-dark-elevated">
                <View className="flex-row items-center gap-2">
                    <Ionicons name="refresh-outline" size={16} color="#D47F00" />
                    <Text
                        className="flex-1 font-sans-semibold text-sm text-neutral-900 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {row.model ?? 'Veículo sem modelo'}
                    </Text>
                </View>
                {vehicleParts.length > 1 || row.chassis || row.color ? (
                    <Text
                        className="mt-1 font-sans text-xs text-neutral-500 dark:text-dark-text-muted"
                        numberOfLines={2}
                    >
                        {[
                            row.chassis ? `Chassi: ${row.chassis}` : null,
                            row.color ? `Cor: ${row.color}` : null,
                        ]
                            .filter(Boolean)
                            .join('  ·  ')}
                    </Text>
                ) : null}
            </View>

            {/* Bloco Retorno */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Abrir O.S. de retorno #${row.return_os_id}`}
                onPress={() => onOpenOS(row.return_os_id)}
                className="border-b border-neutral-50 px-4 py-3 active:bg-neutral-50 dark:border-dark-border-soft dark:active:bg-dark-elevated"
            >
                <View className="mb-1.5 flex-row items-center gap-2">
                    <Badge label="Retorno" variant="info" size="sm" />
                    <Text className="font-sans-semibold text-xs text-neutral-500 dark:text-dark-text-muted">
                        {formatDateBR(row.return_date)}
                    </Text>
                    <Ionicons
                        name="chevron-forward"
                        size={14}
                        color="#98A2B3"
                        style={{ marginLeft: 'auto' }}
                    />
                </View>
                <ReturnField label="Quem fez" values={row.return_workers} />
                <ReturnField label="O que foi feito" values={row.return_services} />
                <ReturnNote note={row.return_notes} />
            </Pressable>

            {/* Bloco Anterior (origem) */}
            {row.origin_os_id != null ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir O.S. anterior #${row.origin_os_id}`}
                    onPress={() => onOpenOS(row.origin_os_id as number)}
                    className="px-4 py-3 active:bg-neutral-50 dark:active:bg-dark-elevated"
                >
                    <View className="mb-1.5 flex-row items-center gap-2">
                        <Badge label="Anterior" variant="neutral" size="sm" />
                        <Text className="font-sans-semibold text-xs text-neutral-500 dark:text-dark-text-muted">
                            {row.origin_date ? formatDateBR(row.origin_date) : '—'}
                        </Text>
                        <Ionicons
                            name="chevron-forward"
                            size={14}
                            color="#98A2B3"
                            style={{ marginLeft: 'auto' }}
                        />
                    </View>
                    <ReturnField label="Quem fez" values={row.origin_workers} />
                    <ReturnField label="O que foi feito" values={row.origin_services} />
                    <ReturnNote note={row.origin_notes} />
                </Pressable>
            ) : (
                <View className="px-4 py-3">
                    <Badge label="Anterior" variant="neutral" size="sm" />
                    <Text className="mt-1.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        Sem O.S. de origem vinculada.
                    </Text>
                </View>
            )}
        </View>
    );
}

function ReturnField({ label, values }: { label: string; values: string[] }) {
    if (!values || values.length === 0) return null;
    return (
        <Text className="mt-0.5 font-sans text-xs text-neutral-600 dark:text-dark-text-muted">
            <Text className="font-sans-semibold text-neutral-500 dark:text-dark-text-muted">
                {label}:{' '}
            </Text>
            {values.join(', ')}
        </Text>
    );
}

function ReturnNote({ note }: { note: string | null }) {
    if (!note) return null;
    return (
        <Text
            className="mt-0.5 font-sans text-xs italic text-neutral-500 dark:text-dark-text-muted"
            numberOfLines={3}
        >
            <Text className="font-sans-semibold not-italic text-neutral-500 dark:text-dark-text-muted">
                Obs.:{' '}
            </Text>
            {note}
        </Text>
    );
}

// ─── Subcomponentes compartilhados ───────────────────────────────────────────

/** Campo de data no estilo escuro dos filtros (reuso entre Resumo/Retornos). */
function DateField({
    label,
    value,
    onChangeText,
}: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
}) {
    return (
        <TextInput
            accessibilityLabel={label}
            placeholder="AAAA-MM-DD"
            value={value}
            onChangeText={onChangeText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            placeholderTextColor="#98A2B3"
            className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 font-sans text-base text-white"
            style={{ color: '#FFFFFF' }}
        />
    );
}

/** KPI compacto para o Resumo (2 por linha em tela estreita). */
function KpiTile({
    icon,
    label,
    value,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
}) {
    return (
        <View className="min-w-[45%] flex-1 basis-[45%] rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-center gap-1.5">
                <Ionicons name={icon} size={14} color="#D47F00" />
                <Text
                    className="flex-1 font-sans-medium text-xs text-neutral-400 dark:text-dark-text-muted"
                    numberOfLines={1}
                >
                    {label}
                </Text>
            </View>
            <Text
                className="mt-1.5 font-display-bold text-lg text-neutral-900 dark:text-dark-text"
                numberOfLines={1}
                adjustsFontSizeToFit
            >
                {value}
            </Text>
        </View>
    );
}

function SummarySkeleton() {
    return (
        <View className="p-4">
            <View className="flex-row flex-wrap gap-3">
                {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} width="45%" height={80} radius={16} />
                ))}
            </View>
            <Skeleton width="100%" height={200} radius={16} className="mt-4" />
        </View>
    );
}

function FilterLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
            {children}
        </Text>
    );
}

function DarkPicker({ value, onPress }: { value: string; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={value}
            onPress={onPress}
            className="min-h-[44px] flex-row items-center justify-between rounded-lg bg-white/10 px-3 py-2 active:opacity-70"
        >
            <Text className="flex-1 font-sans text-base text-white" numberOfLines={1}>
                {value}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#98A2B3" />
        </Pressable>
    );
}

function SummaryTile({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <View className="flex-1 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <Text className="font-sans-medium text-xs text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text
                className="mt-1.5 font-display-bold text-xl text-neutral-900 dark:text-dark-text"
                numberOfLines={1}
                adjustsFontSizeToFit
            >
                {value}
            </Text>
            {note ? (
                <View className="mt-2">
                    <Badge label={note} variant="neutral" size="sm" />
                </View>
            ) : null}
        </View>
    );
}

function GroupsSkeleton() {
    return (
        <View className="gap-4 p-4">
            {[0, 1, 2].map((i) => (
                <View
                    key={i}
                    className="overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <View className="flex-row justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-dark-border-soft dark:bg-dark-elevated">
                        <Skeleton width="45%" height={16} />
                        <Skeleton width="25%" height={16} />
                    </View>
                    <View className="px-4 py-3">
                        <Skeleton width="60%" height={14} />
                        <Skeleton width="40%" height={12} className="mt-2" />
                    </View>
                </View>
            ))}
        </View>
    );
}

function IndividualSkeleton() {
    return (
        <View className="p-4">
            <View className="flex-row gap-3">
                <Skeleton width="48%" height={92} radius={16} />
                <Skeleton width="48%" height={92} radius={16} />
            </View>
            <Skeleton width="100%" height={220} radius={16} className="mt-4" />
        </View>
    );
}
