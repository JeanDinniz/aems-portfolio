import { useCallback, useRef, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { OSStatusBadge } from '@/components/ui/OSStatusBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { PhotoGrid } from '@/components/features/PhotoGrid';
import { OSTimeline, type OSTimelineItem } from '@/components/features/OSTimeline';
import { StatusChangeSheet, type StatusChangeSheetRef } from '@/components/features/StatusChangeSheet';
import { CancelOSSheet, type CancelOSSheetRef } from '@/components/features/CancelOSSheet';
import { useToast } from '@/components/ui/Toast';
import { useServiceOrder, useOSHistory, useUpdateServiceOrderStatus } from '@/hooks/useServiceOrders';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { getApiErrorMessage } from '@/lib/api-error';
import { DEPARTMENTS_MAP } from '@/constants/service-orders';
import { formatDateBR, formatDateTimeBR } from '@/utils/formatDate';
import type { ServiceOrder } from '@/types/service-order.types';
import type { ServiceOrdersStackScreenProps } from '@/navigation/types';

/**
 * OS-03 — Detalhe completo da Ordem de Serviço (doc 03 §4).
 *
 * Seções: Detalhes (veículo/placa/depto/NF/consultor/datas/flags), Observações
 * (notes + internal_notes em destaque âmbar), Itens, Equipe, Fotos (OS + avaria)
 * e Histórico. Ações de status visíveis conforme `useCanEdit('service_orders')`:
 *  - Iniciar → StatusChangeSheet (waiting → in_progress).
 *  - Alterar status → StatusChangeSheet (inclui "Finalizado" como troca simples).
 *  - Cancelar → CancelOSSheet (ação destrutiva, DELETE).
 *  - Editar → EditServiceOrder (OS-07), respeitando a janela de edição
 *    (não verificada E criada há ≤7 dias — idêntico ao web `canEdit`).
 *
 * Este é o módulo de acompanhamento BÁSICO de status — a finalização RICA
 * (fotos de chancela + bobina + funcionários) pertence ao módulo de Agendamento.
 * Nunca quality_check/delivered.
 */

function formatBRL(value: number | null | undefined): string {
    const n = typeof value === 'number' ? value : 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Janela de edição (idêntica ao web `canEdit`): não verificada E criada há ≤7 dias. */
function isWithinEditWindow(order: ServiceOrder): boolean {
    if (order.is_verified) return false;
    const entry = order.entry_time ?? order.created_at;
    if (!entry) return true;
    const diffMs = Date.now() - new Date(entry).getTime();
    if (Number.isNaN(diffMs)) return true;
    return diffMs <= SEVEN_DAYS_MS;
}

export function ServiceOrderDetailScreen({
    route,
    navigation,
}: ServiceOrdersStackScreenProps<'ServiceOrderDetail'>) {
    const { id } = route.params;
    const canEdit = useCanEdit('service_orders');
    const toast = useToast();
    const resolveDuplicate = useUpdateServiceOrderStatus();

    const statusSheetRef = useRef<StatusChangeSheetRef>(null);
    const cancelSheetRef = useRef<CancelOSSheetRef>(null);

    const { data: order, isLoading, isError, refetch } = useServiceOrder(id);

    const handleResolveDuplicate = useCallback(() => {
        // Resolve a duplicidade voltando a O.S. para "Aguardando" (regra do backend).
        resolveDuplicate.mutate(
            { id, status: 'waiting' },
            {
                onSuccess: () => {
                    toast.success('Duplicidade resolvida. O.S. movida para Aguardando.');
                    void refetch();
                },
                onError: (err) => {
                    toast.error(
                        getApiErrorMessage(err as Error, 'Não foi possível resolver a duplicidade.')
                    );
                },
            }
        );
    }, [resolveDuplicate, id, toast, refetch]);
    const { data: historyData, isLoading: historyLoading } = useOSHistory(id);
    const historyItems = (historyData?.items ?? []) as OSTimelineItem[];

    const openPhotos = useCallback(
        (sectionPhotos: string[], index: number) => {
            navigation.navigate('PhotoViewer', { photos: sectionPhotos, index, title: 'Fotos' });
        },
        [navigation]
    );

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Carregando..." onBack={() => navigation.goBack()} />
                <DetailSkeleton />
            </View>
        );
    }

    if (isError || !order) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Ordem de Serviço" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={`OS ${order.external_os_number || '—'}`}
                onBack={() => navigation.goBack()}
                right={<OSStatusBadge status={order.status} size="sm" />}
            />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Detalhes */}
                <Section title="Detalhes">
                    <Row label="Veículo" value={vehicleLabel(order)} />
                    <Row label="Placa" value={order.plate || '—'} mono />
                    <Row label="Departamento" value={DEPARTMENTS_MAP[order.department] ?? '—'} />
                    <Row label="Loja" value={order.location_name || '—'} />
                    {order.dealership_name ? (
                        <Row label="Concessionária" value={order.dealership_name} />
                    ) : null}
                    <Row label="NF / Nota" value={order.invoice_number || '—'} />
                    <Row label="Consultor" value={order.consultant_name || '—'} />
                    <Row label="Data do serviço" value={formatDateBR(order.service_date)} />
                    <Row label="Entrada" value={formatDateTimeBR(order.entry_time)} />
                    <Row label="Início" value={formatDateTimeBR(order.started_at)} />
                    <Row label="Finalização" value={formatDateTimeBR(order.completed_at)} />
                    {order.updated_at ? (
                        <Row
                            label="Atualizado"
                            value={
                                formatDateTimeBR(order.updated_at) +
                                (order.updated_by_name ? ` · ${order.updated_by_name}` : '')
                            }
                        />
                    ) : null}

                    {(order.is_galpon || order.is_return || order.is_courtesy || order.is_verified) && (
                        <View className="mt-3 flex-row flex-wrap gap-1.5">
                            {order.is_galpon ? <Chip label="Galpão" /> : null}
                            {order.is_return ? <Chip label="Retorno" /> : null}
                            {order.is_courtesy ? <Chip label="Cortesia" /> : null}
                            {order.is_verified ? <Chip label="Conferida" tone="success" /> : null}
                        </View>
                    )}
                </Section>

                {/* Observações */}
                {(order.notes || order.internal_notes) && (
                    <Section title="Observações">
                        {order.notes ? (
                            <Text className="font-sans text-sm text-neutral-700 dark:text-dark-text">
                                {order.notes}
                            </Text>
                        ) : null}
                        {order.internal_notes ? (
                            <View className="mt-3 rounded-xl bg-warning-light p-3 dark:bg-dark-elevated">
                                <Text className="mb-1 font-sans-semibold text-xs uppercase tracking-wide text-primary-700 dark:text-brand">
                                    Nota interna
                                </Text>
                                <Text className="font-sans text-sm text-primary-800 dark:text-dark-text">
                                    {order.internal_notes}
                                </Text>
                            </View>
                        ) : null}
                    </Section>
                )}

                {/* Itens */}
                <Section title={`Itens (${order.items?.length ?? 0})`}>
                    {order.items && order.items.length > 0 ? (
                        <View className="gap-2">
                            {order.items.map((item, idx) => {
                                // Retalho: sobra de corte anterior (já debitada na época).
                                // Pode estar no item (tonalidade única) ou em alguma das
                                // aplicações por região (item multi-tonalidade).
                                const usedScrap =
                                    item.used_scrap ||
                                    (item.film_applications ?? []).some((a) => a.used_scrap);
                                return (
                                <View
                                    key={`${item.service_id}-${idx}`}
                                    className="rounded-xl border border-neutral-100 p-3 dark:border-dark-border-soft"
                                >
                                    <View className="flex-row items-start justify-between gap-2">
                                        <Text
                                            className="flex-1 font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                                            numberOfLines={2}
                                        >
                                            {item.service_name || item.service_code || `Serviço ${item.service_id}`}
                                        </Text>
                                        {usedScrap ? <Chip label="Retalho" tone="brand" /> : null}
                                        <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                                            {formatBRL(item.unit_price)}
                                        </Text>
                                    </View>
                                    <View className="mt-1 flex-row flex-wrap gap-x-4 gap-y-0.5">
                                        <Meta label="Qtd" value={String(item.quantity)} />
                                        {item.tonality ? (
                                            <Meta label="Tonalidade" value={item.tonality} />
                                        ) : null}
                                        {item.roll_code && !usedScrap ? (
                                            <Meta label="Bobina" value={item.roll_code} />
                                        ) : null}
                                        {usedScrap ? (
                                            <Meta
                                                label="Bobina"
                                                value={
                                                    item.scrap_source_roll_id
                                                        ? `retalho (origem #${item.scrap_source_roll_id})`
                                                        : 'retalho (sem débito)'
                                                }
                                            />
                                        ) : null}
                                    </View>
                                </View>
                                );
                            })}
                        </View>
                    ) : (
                        <Empty text="Nenhum serviço vinculado." />
                    )}
                </Section>

                {/* Equipe */}
                <Section title={`Equipe (${order.workers?.length ?? 0})`}>
                    {order.workers && order.workers.length > 0 ? (
                        <View className="gap-2">
                            {order.workers.map((w) => (
                                <View key={w.id} className="flex-row items-center gap-3">
                                    <View className="h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-dark-elevated">
                                        <Text className="font-sans-bold text-sm text-neutral-600 dark:text-dark-text">
                                            {initials(w.name)}
                                        </Text>
                                    </View>
                                    <Text className="flex-1 font-sans-medium text-sm text-neutral-800 dark:text-dark-text">
                                        {w.name}
                                    </Text>
                                    {w.isPrimary ? <Chip label="Principal" tone="brand" /> : null}
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Empty text="Nenhum funcionário vinculado." />
                    )}
                </Section>

                {/* Fotos */}
                <Section title="Fotos">
                    <PhotoGrid
                        photos={order.photos ?? []}
                        damagePhotos={order.damage_photos ?? []}
                        onPressPhoto={openPhotos}
                    />
                </Section>

                {/* Histórico */}
                <Section title="Histórico">
                    <OSTimeline items={historyItems} loading={historyLoading} />
                </Section>

                {/* Ações de status (OS-08/09) */}
                {canEdit ? (
                    <View className="mt-2 gap-2">
                        {order.status === 'duplicate' ? (
                            <Button
                                title="Resolver duplicidade"
                                icon="copy-outline"
                                loading={resolveDuplicate.isPending}
                                disabled={resolveDuplicate.isPending}
                                onPress={handleResolveDuplicate}
                            />
                        ) : null}
                        {order.status === 'waiting' ? (
                            <Button
                                title="Iniciar O.S"
                                icon="play"
                                onPress={() => statusSheetRef.current?.present()}
                            />
                        ) : null}
                        {order.status !== 'cancelled' ? (
                            <Button
                                title="Alterar status"
                                icon="swap-vertical-outline"
                                variant="secondary"
                                onPress={() => statusSheetRef.current?.present()}
                            />
                        ) : null}
                        {isWithinEditWindow(order) ? (
                            <Button
                                title="Editar"
                                icon="create-outline"
                                variant="secondary"
                                onPress={() => navigation.navigate('EditServiceOrder', { id: order.id })}
                            />
                        ) : null}
                        {order.status !== 'cancelled' ? (
                            <Button
                                title="Cancelar O.S"
                                icon="close-circle-outline"
                                variant="destructive"
                                onPress={() => cancelSheetRef.current?.present()}
                            />
                        ) : null}
                    </View>
                ) : null}
            </ScrollView>

            {/* Sheets de ação (OS-08/09) */}
            {canEdit ? (
                <>
                    <StatusChangeSheet
                        ref={statusSheetRef}
                        serviceOrderId={order.id}
                        currentStatus={order.status}
                        onChanged={() => void refetch()}
                    />
                    <CancelOSSheet
                        ref={cancelSheetRef}
                        serviceOrderId={order.id}
                        onCancelled={() => navigation.goBack()}
                    />
                </>
            ) : null}
        </View>
    );
}

// ─── Helpers de apresentação ───────────────────────────────────────────────

function vehicleLabel(order: ServiceOrder): string {
    return (
        [order.vehicle_brand, order.vehicle_model, order.vehicle_color].filter(Boolean).join(' · ') ||
        '—'
    );
}

function initials(name: string): string {
    return (
        name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p.charAt(0).toUpperCase())
            .join('') || '?'
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View className="mb-4 rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm dark:border-dark-border-soft dark:bg-dark-surface">
            <Text className="mb-3 font-display-bold text-base text-neutral-900 dark:text-dark-text">
                {title}
            </Text>
            {children}
        </View>
    );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <View className="flex-row items-start justify-between gap-3 border-b border-neutral-50 py-2 last:border-b-0 dark:border-dark-border-soft">
            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">{label}</Text>
            <Text
                className={`flex-1 text-right font-sans-semibold text-sm text-neutral-800 dark:text-dark-text ${
                    mono ? 'font-mono tracking-wider' : ''
                }`}
            >
                {value}
            </Text>
        </View>
    );
}

function Meta({ label, value }: { label: string; value: string }) {
    return (
        <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
            {label}: <Text className="font-sans-semibold text-neutral-600 dark:text-dark-text">{value}</Text>
        </Text>
    );
}

type ChipTone = 'neutral' | 'brand' | 'success';

function Chip({ label, tone = 'neutral' }: { label: string; tone?: ChipTone }) {
    const cls: Record<ChipTone, string> = {
        neutral: 'bg-neutral-100 dark:bg-dark-elevated',
        brand: 'bg-brand',
        success: 'bg-success-light dark:bg-dark-elevated',
    };
    const text: Record<ChipTone, string> = {
        neutral: 'text-neutral-500 dark:text-dark-text-muted',
        brand: 'text-brand-black',
        success: 'text-success',
    };
    return (
        <View className={`rounded-full px-2 py-0.5 ${cls[tone]}`}>
            <Text className={`font-sans-medium text-[11px] ${text[tone]}`}>{label}</Text>
        </View>
    );
}

function Empty({ text }: { text: string }) {
    return (
        <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">{text}</Text>
    );
}

function DetailSkeleton() {
    return (
        <View className="p-4">
            {[0, 1, 2].map((i) => (
                <View
                    key={i}
                    className="mb-4 rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <Skeleton width="40%" height={18} />
                    <View className="mt-3 gap-2">
                        <Skeleton width="100%" height={14} />
                        <Skeleton width="80%" height={14} />
                        <Skeleton width="90%" height={14} />
                    </View>
                </View>
            ))}
        </View>
    );
}
