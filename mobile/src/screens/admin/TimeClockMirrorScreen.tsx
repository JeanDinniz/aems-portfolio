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
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Select, type SelectOption, type SelectRef } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useTimeClockMirror } from '@/hooks/useTimeClock';
import { useStores } from '@/hooks/useStores';
import { useStoreStore } from '@/stores/store.store';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';
import { mediaHeaders } from '@/lib/mediaSource';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatTimeBR } from '@/utils/formatDate';
import type { TimeClockMirrorRecord } from '@/types/time-clock.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Espelho de Ponto (Admin) — paridade com o web `TimeClockMirrorPage`.
 *
 * - Filtros: loja (Select), data (AAAA-MM-DD) e busca por nome (client-side).
 * - Lista paginada de batidas em cards com thumbnail da selfie (toque →
 *   PhotoViewer), tipo (entrada/saída), horário, distância e badge de geofence
 *   (Na loja / Fora da loja / Sem geofence). `distance_m`/`is_within_radius`
 *   podem ser null.
 * - Export PDF do dia via `downloadAndSharePdf` (degrada no Expo Go → toast).
 *
 * Header próprio (preto) — o AdminStack usa `headerShown: false`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 20;

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function formatDistance(distanceM: number | null): string {
    if (distanceM == null) return '—';
    if (distanceM < 1000) return `${Math.round(distanceM)}m`;
    return `${(distanceM / 1000).toFixed(1).replace('.', ',')}km`;
}

export function TimeClockMirrorScreen({
    navigation,
}: AdminStackScreenProps<'TimeClockMirrorAdmin'>) {
    const toast = useToast();
    const { stores } = useStores();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const storeSheetRef = useRef<SelectRef>(null);

    const [storeId, setStoreId] = useState<number | 'all'>(selectedStoreId ?? 'all');
    const [date, setDate] = useState<string>(todayIso());
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [exporting, setExporting] = useState(false);

    const validDate = DATE_RE.test(date) ? date : undefined;

    const { data, isLoading, isError, refetch, isRefetching } = useTimeClockMirror({
        store_id: storeId !== 'all' ? storeId : undefined,
        date: validDate,
        page,
        limit: PAGE_SIZE,
    });

    // Filtro client-side por nome do funcionário.
    const items = useMemo(() => {
        const all = data?.items ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter((r) => r.employee_name.toLowerCase().includes(q));
    }, [data, search]);

    const pagination = data?.pagination;
    const total = pagination?.total ?? 0;

    const storeOptions = useMemo<SelectOption<number>[]>(
        () => [
            { value: 0, label: 'Todas as lojas' },
            ...stores.map((s) => ({ value: s.id, label: s.name })),
        ],
        [stores]
    );
    const storeLabel =
        storeId === 'all' ? 'Todas as lojas' : stores.find((s) => s.id === storeId)?.name ?? 'Loja';

    const openPhoto = useCallback(
        (record: TimeClockMirrorRecord) => {
            const uri = resolveMediaUrl(record.photo_url);
            if (!uri) return;
            navigation.navigate('PhotoViewer', {
                photos: [uri],
                title: record.employee_name,
            });
        },
        [navigation]
    );

    const handleExport = useCallback(async () => {
        if (exporting) return;
        const exportStoreId = storeId !== 'all' ? storeId : stores[0]?.id;
        if (!exportStoreId) {
            toast.error('Selecione uma loja para exportar.');
            return;
        }
        if (!validDate) {
            toast.error('Informe uma data válida (AAAA-MM-DD).');
            return;
        }
        setExporting(true);
        try {
            await downloadAndSharePdf({
                path: '/time-clock/export/pdf',
                params: { store_id: exportStoreId, date: validDate },
                filename: `espelho-ponto-${validDate}.pdf`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, storeId, stores, validDate, toast]);

    const subtitle = isLoading
        ? 'Carregando...'
        : `${total} ${total === 1 ? 'registro' : 'registros'}`;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto */}
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
                                Espelho de Ponto
                            </Text>
                            <Text className="mt-0.5 font-sans text-sm text-neutral-400">
                                {subtitle}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Exportar PDF"
                            accessibilityState={{ busy: exporting, disabled: exporting }}
                            disabled={exporting}
                            onPress={() => void handleExport()}
                            className={`h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70 ${
                                exporting ? 'opacity-50' : ''
                            }`}
                        >
                            {exporting ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                            )}
                        </Pressable>
                    </View>

                    {/* Filtros: loja + data + busca */}
                    <View className="mt-3 gap-3">
                        <View className="flex-row gap-3">
                            <View className="flex-1">
                                <FilterLabel>Loja</FilterLabel>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Filtrar por loja: ${storeLabel}`}
                                    onPress={() => storeSheetRef.current?.present()}
                                    className="min-h-[44px] flex-row items-center justify-between rounded-lg bg-white/10 px-3 py-2 active:opacity-70"
                                >
                                    <Text
                                        className="flex-1 font-sans text-base text-white"
                                        numberOfLines={1}
                                    >
                                        {storeLabel}
                                    </Text>
                                    <Ionicons name="chevron-down" size={18} color="#98A2B3" />
                                </Pressable>
                            </View>
                            <View className="w-[140px]">
                                <FilterLabel>Data</FilterLabel>
                                <TextInput
                                    accessibilityLabel="Data"
                                    placeholder="AAAA-MM-DD"
                                    value={date}
                                    onChangeText={(t) => {
                                        setDate(t);
                                        setPage(1);
                                    }}
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
                            <FilterLabel>Funcionário</FilterLabel>
                            <View className="flex-row items-center rounded-lg bg-white/10 px-3">
                                <Ionicons name="search-outline" size={18} color="#98A2B3" />
                                <TextInput
                                    accessibilityLabel="Buscar funcionário"
                                    placeholder="Buscar funcionário..."
                                    value={search}
                                    onChangeText={setSearch}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    placeholderTextColor="#98A2B3"
                                    className="ml-2 min-h-[44px] flex-1 py-2 font-sans text-base text-white"
                                    style={{ color: '#FFFFFF' }}
                                />
                            </View>
                        </View>
                    </View>
                </View>
            </SafeAreaView>

            {/* Conteúdo */}
            {isLoading ? (
                <ListSkeleton />
            ) : isError ? (
                <ErrorState onRetry={() => void refetch()} />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {items.length === 0 ? (
                        <EmptyState
                            icon="time-outline"
                            title="Nenhum registro"
                            description={
                                search
                                    ? 'Nenhum funcionário corresponde à busca.'
                                    : 'Nenhuma batida encontrada para esta loja e data.'
                            }
                        />
                    ) : (
                        <View className="gap-3">
                            {items.map((record) => (
                                <RecordCard
                                    key={record.id}
                                    record={record}
                                    onPressPhoto={() => openPhoto(record)}
                                />
                            ))}
                        </View>
                    )}

                    {/* Paginação (sobre o total do backend, não o filtro client-side) */}
                    {pagination && pagination.total_pages > 1 ? (
                        <View className="mt-4 flex-row items-center justify-between">
                            <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                Página {pagination.page} de {pagination.total_pages}
                            </Text>
                            <View className="flex-row gap-2">
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Página anterior"
                                    accessibilityState={{ disabled: !pagination.has_prev }}
                                    disabled={!pagination.has_prev}
                                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                                    className={`h-11 w-11 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated ${
                                        !pagination.has_prev ? 'opacity-40' : ''
                                    }`}
                                >
                                    <Ionicons name="chevron-back" size={20} color="#667085" />
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="Próxima página"
                                    accessibilityState={{ disabled: !pagination.has_next }}
                                    disabled={!pagination.has_next}
                                    onPress={() => setPage((p) => p + 1)}
                                    className={`h-11 w-11 items-center justify-center rounded-full bg-neutral-100 active:opacity-70 dark:bg-dark-elevated ${
                                        !pagination.has_next ? 'opacity-40' : ''
                                    }`}
                                >
                                    <Ionicons name="chevron-forward" size={20} color="#667085" />
                                </Pressable>
                            </View>
                        </View>
                    ) : null}
                </ScrollView>
            )}

            {/* Sheet de filtro de loja */}
            <Select<number>
                ref={storeSheetRef}
                title="Filtrar por loja"
                options={storeOptions}
                value={storeId === 'all' ? 0 : storeId}
                onChange={(v) => {
                    setStoreId(v === 0 ? 'all' : v);
                    setPage(1);
                }}
            />
        </View>
    );
}

// ─── subcomponentes ──────────────────────────────────────────────────────────

function FilterLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1 font-sans-medium text-xs uppercase tracking-wide text-neutral-400">
            {children}
        </Text>
    );
}

function GeofenceBadge({ record }: { record: TimeClockMirrorRecord }) {
    if (record.is_within_radius === true) {
        return <Badge label="Na loja" variant="success" size="sm" icon="location" />;
    }
    if (record.is_within_radius === false) {
        return <Badge label="Fora da loja" variant="warning" size="sm" icon="alert-circle" />;
    }
    return <Badge label="Sem geofence" variant="neutral" size="sm" />;
}

/**
 * Sinais de batida offline (REP-A). "Offline" (neutro) quando a marcação foi
 * coletada sem rede; "Sync tardio" (alerta) quando essa batida offline só foi
 * sincronizada >24h depois — sinal para o RH conferir contra backdating.
 */
function OfflineBadges({ record }: { record: TimeClockMirrorRecord }) {
    if (!record.is_offline_record) return null;
    return (
        <>
            <Badge label="Offline" variant="info" size="sm" icon="cloud-offline-outline" />
            {record.offline_sync_late ? (
                <Badge label="Sync tardio" variant="warning" size="sm" icon="alert-circle" />
            ) : null}
        </>
    );
}

function RecordCard({
    record,
    onPressPhoto,
}: {
    record: TimeClockMirrorRecord;
    onPressPhoto: () => void;
}) {
    const isIn = record.type === 'in';
    const photoUri = resolveMediaUrl(record.photo_url);
    return (
        <View className="flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-3 dark:border-dark-border-soft dark:bg-dark-surface">
            {/* Thumbnail da selfie */}
            <Pressable
                accessibilityRole="imagebutton"
                accessibilityLabel={`Ver foto de ${record.employee_name}`}
                onPress={onPressPhoto}
                className="h-14 w-14 overflow-hidden rounded-xl bg-neutral-100 active:opacity-80 dark:bg-dark-elevated"
            >
                {photoUri ? (
                    <Image
                        source={{ uri: photoUri, headers: mediaHeaders() }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        transition={100}
                        cachePolicy="memory-disk"
                    />
                ) : (
                    <View className="h-full w-full items-center justify-center">
                        <Ionicons name="person-outline" size={22} color="#98A2B3" />
                    </View>
                )}
            </Pressable>

            {/* Info */}
            <View className="flex-1">
                <Text
                    className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                    numberOfLines={1}
                >
                    {record.employee_name}
                </Text>
                <View className="mt-1 flex-row items-center gap-2">
                    <Badge
                        label={isIn ? 'Entrada' : 'Saída'}
                        variant={isIn ? 'success' : 'warning'}
                        size="sm"
                        icon={isIn ? 'log-in-outline' : 'log-out-outline'}
                    />
                    <Text className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        {formatTimeBR(record.recorded_at)}
                    </Text>
                </View>
                <View className="mt-1.5 flex-row flex-wrap items-center gap-2">
                    <GeofenceBadge record={record} />
                    <OfflineBadges record={record} />
                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        {formatDistance(record.distance_m)}
                        {record.accuracy_m != null
                            ? ` · ±${Math.round(record.accuracy_m)}m`
                            : ''}
                    </Text>
                </View>
            </View>
        </View>
    );
}

function ListSkeleton() {
    return (
        <View className="gap-3 p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
                <View
                    key={i}
                    className="flex-row items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-3 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width={56} height={56} radius={12} />
                    <View className="flex-1">
                        <Skeleton width="55%" height={16} />
                        <Skeleton width="40%" height={12} className="mt-2" />
                        <Skeleton width="30%" height={12} className="mt-2" />
                    </View>
                </View>
            ))}
        </View>
    );
}
