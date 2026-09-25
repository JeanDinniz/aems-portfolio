import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { PunchReceipt } from '@/components/time-clock/PunchReceipt';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useMyMirror } from '@/hooks/useTimeClock';
import { downloadAndSharePdf } from '@/utils/exportShare';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatDateBR, formatTimeBR, ymdLocal } from '@/utils/formatDate';
import type { MyMirrorPeriod, TimeClockRecord } from '@/types/time-clock.types';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * Meu Espelho — autoatendimento do funcionário (Portaria MTP 671/2021).
 *
 * O próprio trabalhador consulta suas batidas das últimas 24h ou do mês corrente
 * (toggle 24h/Mês → `GET /time-clock/me/mirror`) e exporta o espelho em PDF
 * (`GET /time-clock/me/export/pdf` via `downloadAndSharePdf`).
 *
 * Registros com `source === 'admin_adjustment'` (ajustes lançados pelo gestor)
 * são marcados visualmente como "(ajuste)". A hora oficial exibida é sempre a do
 * servidor (`recorded_at`); quando há `client_reported_at` diferente (batida
 * feita offline), mostramos o horário real do aparelho como referência.
 */

const PERIOD_LABEL: Record<MyMirrorPeriod, string> = {
    '24h': 'Últimas 24h',
    month: 'Mês corrente',
};

export function MyTimeClockMirrorScreen({
    navigation,
}: AppStackScreenProps<'MyTimeClockMirror'>) {
    const toast = useToast();
    const [period, setPeriod] = useState<MyMirrorPeriod>('24h');
    const { data, isLoading, isError, refetch, isRefetching } = useMyMirror(period);

    const [exporting, setExporting] = useState(false);

    const handleExport = useCallback(async () => {
        if (exporting) return;
        setExporting(true);
        try {
            const suffix = period === '24h' ? '24h' : ymdLocal().slice(0, 7).replace('-', '');
            await downloadAndSharePdf({
                path: '/time-clock/me/export/pdf',
                params: { period },
                filename: `meu_espelho_ponto_${suffix}.pdf`,
            });
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar o PDF.'));
        } finally {
            setExporting(false);
        }
    }, [exporting, period, toast]);

    const items = useMemo(() => data?.items ?? [], [data]);

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Meu Espelho" onBack={() => navigation.goBack()} />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                refreshControl={
                    <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                }
            >
                {/* ─── Toggle 24h / Mês ─────────────────────────────────────── */}
                <View className="mb-4 flex-row gap-2 rounded-xl bg-neutral-100 p-1 dark:bg-dark-elevated">
                    {(['24h', 'month'] as MyMirrorPeriod[]).map((p) => {
                        const active = period === p;
                        return (
                            <Pressable
                                key={p}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                                accessibilityLabel={PERIOD_LABEL[p]}
                                onPress={() => setPeriod(p)}
                                className={`flex-1 items-center rounded-lg py-2.5 ${
                                    active ? 'bg-white dark:bg-dark-surface' : ''
                                }`}
                            >
                                <Text
                                    className={`font-sans-semibold text-sm ${
                                        active
                                            ? 'text-neutral-900 dark:text-dark-text'
                                            : 'text-neutral-500 dark:text-dark-text-muted'
                                    }`}
                                >
                                    {PERIOD_LABEL[p]}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>

                {/* ─── Cabeçalho + export ───────────────────────────────────── */}
                {data ? (
                    <Card className="mb-4">
                        <Text className="font-display-bold text-lg text-neutral-900 dark:text-dark-text">
                            {data.employee_name}
                        </Text>
                        {data.store_name ? (
                            <View className="mt-1 flex-row items-center gap-2">
                                <Ionicons name="storefront-outline" size={16} color="#98A2B3" />
                                <Text className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                                    {data.store_name}
                                </Text>
                            </View>
                        ) : null}
                        <View className="mt-3">
                            <Button
                                title="Exportar PDF"
                                icon="download-outline"
                                variant="secondary"
                                size="sm"
                                loading={exporting}
                                disabled={exporting || items.length === 0}
                                onPress={handleExport}
                            />
                        </View>
                    </Card>
                ) : null}

                {/* ─── Estados ──────────────────────────────────────────────── */}
                {isLoading ? (
                    <View className="gap-2">
                        <Skeleton className="h-16 w-full rounded-2xl" />
                        <Skeleton className="h-16 w-full rounded-2xl" />
                        <Skeleton className="h-16 w-full rounded-2xl" />
                    </View>
                ) : isError ? (
                    <ErrorState onRetry={() => void refetch()} />
                ) : items.length === 0 ? (
                    <EmptyState
                        icon="time-outline"
                        title="Nenhuma batida no período"
                        description={
                            period === '24h'
                                ? 'Você não bateu ponto nas últimas 24 horas.'
                                : 'Você não bateu ponto neste mês.'
                        }
                    />
                ) : (
                    <View className="gap-2">
                        {items.map((record) => (
                            <MirrorRow key={record.id} record={record} />
                        ))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

interface MirrorRowProps {
    record: TimeClockRecord;
}

/** Linha do espelho: dia · hora · tipo, com selo "(ajuste)" quando administrativo. */
function MirrorRow({ record }: MirrorRowProps) {
    const isIn = record.type === 'in';
    const isAdjustment = record.source === 'admin_adjustment';
    const outOfRadius = record.is_within_radius === false;

    // Comprovante disponível quando o servidor já atribuiu o NSR (REP-A).
    const hasReceipt = record.nsr != null;
    const [showReceipt, setShowReceipt] = useState(false);

    // Instante real da batida offline (relógio do aparelho), quando diferente do
    // horário oficial do servidor — informativo, não substitui a hora oficial.
    const clientTime =
        record.client_reported_at && record.client_reported_at !== record.recorded_at
            ? formatTimeBR(record.client_reported_at)
            : null;

    return (
        <View className="rounded-xl border border-neutral-100 bg-white p-3 dark:border-dark-border-soft dark:bg-dark-surface">
        <View className="flex-row items-center gap-3">
            <View
                className={`h-11 w-11 items-center justify-center rounded-full ${
                    isAdjustment
                        ? 'bg-brand/15'
                        : isIn
                          ? 'bg-success-light'
                          : 'bg-neutral-100 dark:bg-dark-elevated'
                }`}
            >
                <Ionicons
                    name={
                        isAdjustment
                            ? 'create-outline'
                            : isIn
                              ? 'log-in-outline'
                              : 'log-out-outline'
                    }
                    size={20}
                    color={isAdjustment ? '#F5B800' : isIn ? '#12B76A' : '#667085'}
                />
            </View>

            <View className="flex-1">
                <View className="flex-row items-center gap-2">
                    <Text className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text">
                        {isIn ? 'Entrada' : 'Saída'}
                    </Text>
                    {isAdjustment ? (
                        <Badge label="ajuste" variant="warning" size="sm" />
                    ) : null}
                </View>
                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {`${formatDateBR(record.recorded_at)} · ${formatTimeBR(record.recorded_at)}`}
                </Text>
                {clientTime ? (
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {`Registrada offline às ${clientTime}`}
                    </Text>
                ) : null}
                {isAdjustment && record.adjustment_reason ? (
                    <Text className="mt-0.5 font-sans text-xs italic text-neutral-500 dark:text-dark-text-muted">
                        {record.adjustment_reason}
                    </Text>
                ) : null}
                {outOfRadius ? (
                    <View className="mt-1">
                        <Badge
                            label="Fora do raio"
                            variant="warning"
                            size="sm"
                            icon="warning-outline"
                        />
                    </View>
                ) : null}
            </View>

            {/* Ação para abrir o comprovante (só quando há NSR atribuído). */}
            {hasReceipt ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        showReceipt ? 'Ocultar comprovante' : 'Ver comprovante'
                    }
                    accessibilityState={{ expanded: showReceipt }}
                    onPress={() => setShowReceipt((v) => !v)}
                    className="h-11 flex-row items-center gap-1 pl-2"
                >
                    <Ionicons
                        name={showReceipt ? 'chevron-up' : 'receipt-outline'}
                        size={18}
                        color="#F5B800"
                    />
                    <Text className="font-sans-semibold text-xs text-brand-black dark:text-brand">
                        {showReceipt ? 'Ocultar' : 'Ver comprovante'}
                    </Text>
                </Pressable>
            ) : null}
            </View>

            {hasReceipt && showReceipt ? (
                <View className="mt-2">
                    {record.receipt ? (
                        <PunchReceipt receipt={record.receipt} recordId={record.id} />
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}
