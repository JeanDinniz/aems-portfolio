import { Alert, ScrollView, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useExhaustRoll, useRestoreRoll, useDeleteRoll, useRoll, useRollConsumptions } from '@/hooks/useInventory';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { ROLL_COLOR_CONFIG } from '@/constants/inventory';
import { formatDateBR, formatDateTimeBR } from '@/utils/formatDate';
import type { FilmConsumption } from '@/services/api/inventory.service';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-03 / INV-05 — Detalhe da bobina: metragem, metadados, consumos e ações.
 *
 * Ações (Transferir / Esgotar / Restaurar / Excluir) só com `can_edit`
 * (inventory). Transferir abre a tela TransferRoll; Esgotar/Restaurar/Excluir
 * confirmam via Alert. As mutations invalidam a lista/críticas e este detalhe
 * revalida (queryKey ['inventory-roll', id] participa via ['inventory-rolls']).
 */
export function RollDetailScreen({ route, navigation }: InventoryStackScreenProps<'RollDetail'>) {
    const { id } = route.params;
    const canEdit = useCanEdit('inventory');
    const { data: roll, isLoading, isError, refetch } = useRoll(id);
    const { data: consumptions } = useRollConsumptions(id);

    const exhaustRoll = useExhaustRoll();
    const restoreRoll = useRestoreRoll();
    const deleteRoll = useDeleteRoll();

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Bobina" onBack={() => navigation.goBack()} />
                <View className="gap-4 p-4">
                    <Skeleton width="100%" height={120} />
                    <Skeleton width="100%" height={80} />
                </View>
            </View>
        );
    }

    if (isError || !roll) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Bobina" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const cfg = ROLL_COLOR_CONFIG[roll.color] ?? ROLL_COLOR_CONFIG.blue;
    const pct = roll.total_meters > 0 ? Math.max(0, Math.min(100, (roll.remaining_meters / roll.total_meters) * 100)) : 0;
    const filmLabel = roll.tonality ? `${roll.film_type_name} · ${roll.tonality}` : roll.film_type_name;
    const list = consumptions ?? [];

    const isExhausted = roll.status === 'esgotada';
    const actionBusy = exhaustRoll.isPending || restoreRoll.isPending || deleteRoll.isPending;

    const confirmExhaust = () => {
        Alert.alert('Esgotar bobina', `Marcar a bobina ${roll.visual_id} como esgotada?`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Esgotar',
                style: 'destructive',
                onPress: () => exhaustRoll.mutate(roll.id),
            },
        ]);
    };

    const confirmRestore = () => {
        Alert.alert('Restaurar bobina', `Restaurar a bobina ${roll.visual_id} para o estoque?`, [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Restaurar', onPress: () => restoreRoll.mutate(roll.id) },
        ]);
    };

    const confirmDelete = () => {
        Alert.alert(
            'Excluir bobina',
            `Excluir a bobina ${roll.visual_id}? Esta ação não pode ser desfeita.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Excluir',
                    style: 'destructive',
                    onPress: () =>
                        deleteRoll.mutate(roll.id, {
                            // 409 (tem consumos): a mensagem do backend vai no Toast (hook).
                            onSuccess: () => navigation.goBack(),
                        }),
                },
            ]
        );
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={roll.visual_id}
                onBack={() => navigation.goBack()}
                right={
                    <View
                        className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{ backgroundColor: cfg.badgeBg }}
                    >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cfg.solid }} />
                        <Text className="font-sans-semibold text-[11px]" style={{ color: cfg.badgeFg }}>
                            {cfg.label}
                        </Text>
                    </View>
                }
            />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Metragem */}
                <Section title="Metragem">
                    {/* Altura por estilo inline (não via classe `h-*`): garante 10px
                        de barra e evita o balão quando a classe não resolve. */}
                    <View
                        className="w-full overflow-hidden rounded-full"
                        style={{ height: 10, backgroundColor: cfg.track }}
                    >
                        <View
                            style={{ height: 10, width: `${pct}%`, borderRadius: 999, backgroundColor: cfg.solid }}
                        />
                    </View>
                    <Text className="mt-2 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        {`${roll.remaining_meters.toFixed(1)}m restantes de ${roll.total_meters.toFixed(1)}m`}
                    </Text>
                </Section>

                {/* Dados */}
                <Section title="Dados">
                    <Row label="Película" value={filmLabel} />
                    <Row label="Loja" value={roll.store_name || `Loja ${roll.store_id}`} />
                    <Row label="Fornecedor" value={roll.supplier_name || roll.supplier || '—'} />
                    <Row label="NFe" value={roll.nfe_number || '—'} />
                    <Row label="Lote" value={roll.lot_number || '—'} />
                    <Row
                        label="Custo"
                        value={roll.cost != null ? `R$ ${roll.cost.toFixed(2)}` : '—'}
                    />
                    <Row label="Recebimento" value={formatDateBR(roll.receipt_date)} />
                </Section>

                {/* Consumos */}
                <Section title={`Consumos (${list.length})`}>
                    {list.length === 0 ? (
                        <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Nenhum consumo registrado.
                        </Text>
                    ) : (
                        list.map((c) => <ConsumptionRow key={c.id} consumption={c} />)
                    )}
                </Section>

                {/* Ações (INV-05) — só com can_edit (inventory) */}
                {canEdit ? (
                    <View className="mt-1 gap-2.5">
                        <Text className="mb-1 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                            Ações
                        </Text>
                        <Button
                            title="Transferir para outra loja"
                            variant="secondary"
                            icon="swap-horizontal"
                            disabled={actionBusy || isExhausted}
                            onPress={() =>
                                navigation.navigate('TransferRoll', {
                                    id: roll.id,
                                    currentStoreId: roll.store_id,
                                })
                            }
                        />
                        {isExhausted ? (
                            <Button
                                title="Restaurar bobina"
                                variant="secondary"
                                icon="refresh"
                                loading={restoreRoll.isPending}
                                disabled={actionBusy}
                                onPress={confirmRestore}
                            />
                        ) : (
                            <Button
                                title="Marcar como esgotada"
                                variant="secondary"
                                icon="alert-circle-outline"
                                loading={exhaustRoll.isPending}
                                disabled={actionBusy}
                                onPress={confirmExhaust}
                            />
                        )}
                        <Button
                            title="Excluir bobina"
                            variant="destructive"
                            icon="trash-outline"
                            loading={deleteRoll.isPending}
                            disabled={actionBusy}
                            onPress={confirmDelete}
                        />
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View className="mb-4 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <Text className="mb-3 font-sans-bold text-sm text-neutral-700 dark:text-dark-text">{title}</Text>
            {children}
        </View>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <View className="flex-row justify-between gap-3 py-1.5">
            <Text className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted">{label}</Text>
            <Text
                className="flex-1 text-right font-sans-medium text-sm text-neutral-900 dark:text-dark-text"
                numberOfLines={2}
            >
                {value}
            </Text>
        </View>
    );
}

function ConsumptionRow({ consumption }: { consumption: FilmConsumption }) {
    const vehicle = [consumption.plate, consumption.vehicle_model].filter(Boolean).join(' · ') || 'Veículo —';
    return (
        <View className="flex-row items-center justify-between gap-3 border-t border-neutral-100 py-2.5 first:border-t-0 dark:border-dark-border-soft">
            <View className="flex-1">
                <Text className="font-sans-medium text-sm text-neutral-800 dark:text-dark-text" numberOfLines={1}>
                    {vehicle}
                </Text>
                <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {formatDateTimeBR(consumption.created_at)}
                </Text>
            </View>
            <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                {`${consumption.meters_consumed.toFixed(1)}m`}
            </Text>
        </View>
    );
}
