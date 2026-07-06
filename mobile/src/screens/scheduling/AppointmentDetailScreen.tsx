import { type ReactNode, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import {
    CancelAppointmentSheet,
    type CancelAppointmentSheetRef,
} from '@/components/features/CancelAppointmentSheet';
import { useAppointment, useAppointmentHistory } from '@/hooks/useScheduling';
import { useCanEdit, useCanDelete } from '@/hooks/useMyPermissions';
import { APPOINTMENT_STATUS_CONFIG, DEPARTMENT_LABELS } from '@/constants/scheduling';
import { formatDateBR, formatDateTimeBR, formatClock } from '@/utils/formatDate';
import type { Appointment, AppointmentHistoryEntry } from '@/types/scheduling.types';
import type { SchedulingStackScreenProps } from '@/navigation/types';

/**
 * AGD-04 — Detalhe do Agendamento (SÓ LEITURA + histórico).
 *
 * Seções: Detalhes (placa/veículo/loja/data+hora/OS externa/consultor/depto),
 * Películas (tonalidade por entrada de `film_entries`), Serviços, Observações,
 * O.S. vinculada (quando `service_order_id`) e Histórico (timeline de auditoria
 * a partir de `useAppointmentHistory`).
 *
 * Ações (Gerar O.S./Editar/Cancelar) ficam condicionadas a permissão e, nesta
 * ronda, navegam para os stubs "Em breve" (AGD-03/05). A estrutura está pronta
 * para a próxima ronda plugar as mutations reais.
 */

export function AppointmentDetailScreen({
    route,
    navigation,
}: SchedulingStackScreenProps<'AppointmentDetail'>) {
    const { id } = route.params;
    const canEdit = useCanEdit('scheduling');
    const canGenerateOS = useCanEdit('scheduling_os');
    const canDelete = useCanDelete('scheduling');
    const cancelSheetRef = useRef<CancelAppointmentSheetRef>(null);

    const { data: appointment, isLoading, isError, refetch } = useAppointment(id);
    const { data: historyData, isLoading: historyLoading } = useAppointmentHistory(id);
    const historyItems = historyData?.items ?? [];

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Carregando..." onBack={() => navigation.goBack()} />
                <DetailSkeleton />
            </View>
        );
    }

    if (isError || !appointment) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Agendamento" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const cfg = APPOINTMENT_STATUS_CONFIG[appointment.display_status];
    const time = formatClock(appointment.delivery_time);
    const department = DEPARTMENT_LABELS[appointment.department] ?? appointment.department;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={appointment.vehicle_plate || 'Agendamento'}
                onBack={() => navigation.goBack()}
                right={<StatusBadge label={cfg.label} color={cfg.color} bg={cfg.cardBg} dot={cfg.dot} />}
            />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Detalhes */}
                <Section title="Detalhes">
                    <Row label="Placa" value={appointment.vehicle_plate || '—'} mono />
                    <Row label="Veículo" value={vehicleLabel(appointment)} />
                    <Row label="Departamento" value={department} />
                    <Row label="Loja" value={appointment.store_name || '—'} />
                    <Row label="Data de entrega" value={formatDateBR(appointment.delivery_date)} />
                    <Row label="Horário" value={time} />
                    <Row label="O.S. concessionária" value={appointment.external_os_number || '—'} />
                    <Row label="Consultor" value={appointment.consultant_name || '—'} />

                    {(appointment.is_galpon || appointment.is_courtesy || appointment.is_return) && (
                        <View className="mt-3 flex-row flex-wrap gap-1.5">
                            {appointment.is_galpon ? <Chip label="Galpão" /> : null}
                            {appointment.is_courtesy ? <Chip label="Cortesia" /> : null}
                            {appointment.is_return ? <Chip label="Retorno" /> : null}
                        </View>
                    )}
                </Section>

                {/* Películas (tonalidade por entrada) */}
                {appointment.film_entries && appointment.film_entries.length > 0 ? (
                    <Section title="Películas">
                        <View className="gap-2">
                            {appointment.film_entries.map((entry, idx) => {
                                const serviceName = serviceNameFor(appointment, entry.service_id, idx);
                                return (
                                    <View
                                        key={`${entry.service_id}-${idx}`}
                                        className="flex-row items-center justify-between gap-2 rounded-xl border border-neutral-100 px-3 py-2.5 dark:border-dark-border-soft"
                                    >
                                        <Text
                                            className="flex-1 font-sans-semibold text-sm text-neutral-800 dark:text-dark-text"
                                            numberOfLines={2}
                                        >
                                            {serviceName}
                                        </Text>
                                        {entry.tonality ? (
                                            <View className="rounded-md bg-brand/15 px-2 py-1">
                                                <Text className="font-sans-bold text-xs text-primary-700 dark:text-brand">
                                                    {entry.tonality}
                                                </Text>
                                            </View>
                                        ) : null}
                                    </View>
                                );
                            })}
                        </View>
                    </Section>
                ) : null}

                {/* Serviços */}
                <Section title={`Serviços (${appointment.service_names?.length ?? 0})`}>
                    {appointment.service_names && appointment.service_names.length > 0 ? (
                        <View className="flex-row flex-wrap gap-1.5">
                            {appointment.service_names.map((name, idx) => (
                                <View
                                    key={`${name}-${idx}`}
                                    className="rounded-lg bg-neutral-100 px-2.5 py-1.5 dark:bg-dark-elevated"
                                >
                                    <Text className="font-sans-medium text-sm text-neutral-700 dark:text-dark-text">
                                        {name}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Empty text="Nenhum serviço vinculado." />
                    )}
                </Section>

                {/* Observações */}
                {appointment.notes ? (
                    <Section title="Observações">
                        <Text className="font-sans text-sm text-neutral-700 dark:text-dark-text">
                            {appointment.notes}
                        </Text>
                    </Section>
                ) : null}

                {/* O.S. vinculada */}
                {appointment.service_order_id ? (
                    <Section title="O.S. vinculada">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Abrir O.S. ${appointment.service_order_number ?? ''}`}
                            onPress={() => openLinkedOS(navigation, appointment.service_order_id!)}
                            className="flex-row items-center gap-3 rounded-xl border border-neutral-100 px-3 py-3 active:opacity-70 dark:border-dark-border-soft"
                        >
                            <View className="h-10 w-10 items-center justify-center rounded-full bg-brand/15">
                                <Ionicons name="clipboard-outline" size={20} color="#B58900" />
                            </View>
                            <View className="flex-1">
                                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                    Ordem de serviço
                                </Text>
                                <Text className="font-sans-bold text-sm text-neutral-900 dark:text-dark-text">
                                    {appointment.service_order_number || `#${appointment.service_order_id}`}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
                        </Pressable>
                    </Section>
                ) : null}

                {/* Histórico */}
                <Section title="Histórico">
                    <HistoryTimeline items={historyItems} loading={historyLoading} />
                </Section>

                {/* Ações (AGD-05) */}
                {renderActions(appointment, {
                    canEdit,
                    canGenerateOS,
                    canDelete,
                    navigation,
                    onCancel: () => cancelSheetRef.current?.present(),
                })}
            </ScrollView>

            {/* Sheet de cancelamento (ação destrutiva) */}
            <CancelAppointmentSheet
                ref={cancelSheetRef}
                appointmentId={appointment.id}
                onCancelled={() => navigation.goBack()}
            />
        </View>
    );
}

// ─── Ações do agendamento (AGD-05) ───────────────────────────────────────────

interface ActionsContext {
    canEdit: boolean;
    canGenerateOS: boolean;
    canDelete: boolean;
    navigation: SchedulingStackScreenProps<'AppointmentDetail'>['navigation'];
    onCancel: () => void;
}

/**
 * Botões de ação do detalhe do agendamento, condicionados a permissão + estado:
 *  - Gerar O.S.: sem O.S. vinculada, agendamento aberto (agendado/atrasado/atenção),
 *    `scheduling_os`.edit. Empilha GenerateOS (fotos do veículo + observações).
 *  - Finalizar: O.S. já vinculada e agendamento não finalizado/cancelado,
 *    `scheduling`.edit. Navega cross-stack p/ a tela reusada FinalizeOS da aba O.S.
 *  - Editar: agendamento aberto, `scheduling`.edit.
 *  - Cancelar: agendamento aberto, `scheduling`.delete. Abre o sheet de motivo.
 */
function renderActions(appointment: Appointment, ctx: ActionsContext): ReactNode {
    const { canEdit, canGenerateOS, canDelete, navigation, onCancel } = ctx;
    const isCancelled = appointment.status === 'cancelled';
    const isFinished = appointment.display_status === 'finalizado';
    const isOpen = !isCancelled && !isFinished;
    const hasOS = !!appointment.service_order_id;
    // "Aberto" para gerar O.S.: ainda sem O.S. e nos status de espera/atraso/atenção.
    const canShowGenerate =
        !hasOS &&
        (appointment.display_status === 'agendado' ||
            appointment.display_status === 'atrasado' ||
            appointment.display_status === 'atencao');

    const showGenerate = canGenerateOS && isOpen && canShowGenerate;
    const showFinalize = canEdit && isOpen && hasOS;
    const showEdit = canEdit && isOpen;
    const showCancel = canDelete && isOpen;

    if (!showGenerate && !showFinalize && !showEdit && !showCancel) return null;

    return (
        <View className="mt-2 gap-2">
            {showGenerate ? (
                <Button
                    title="Gerar O.S."
                    icon="add-circle-outline"
                    onPress={() => navigation.navigate('GenerateOS', { id: appointment.id })}
                />
            ) : null}
            {showFinalize ? (
                <Button
                    title="Finalizar O.S."
                    icon="checkmark-done"
                    onPress={() =>
                        // Cross-stack: empilha a tela reusada FinalizeOS na aba O.S.,
                        // passando o id da O.S. vinculada ao agendamento.
                        navigation.navigate('ServiceOrders', {
                            screen: 'FinalizeOS',
                            params: { id: appointment.service_order_id! },
                        })
                    }
                />
            ) : null}
            {showEdit ? (
                <Button
                    title="Editar"
                    icon="create-outline"
                    variant="secondary"
                    onPress={() => navigation.navigate('EditAppointment', { id: appointment.id })}
                />
            ) : null}
            {showCancel ? (
                <Button
                    title="Cancelar agendamento"
                    icon="close-circle-outline"
                    variant="destructive"
                    onPress={onCancel}
                />
            ) : null}
        </View>
    );
}

// ─── Navegação para a O.S. vinculada ─────────────────────────────────────────

/**
 * Abre o detalhe da O.S. vinculada. O detalhe vive no ServiceOrdersStack (outra
 * aba), então navegamos via árvore aninhada de tabs. Se a rota não existir
 * (sem permissão na aba O.S.), o React Navigation simplesmente não navega — o
 * número já está visível no card.
 */
function openLinkedOS(
    navigation: SchedulingStackScreenProps<'AppointmentDetail'>['navigation'],
    serviceOrderId: number
) {
    navigation.navigate('ServiceOrders', {
        screen: 'ServiceOrderDetail',
        params: { id: serviceOrderId },
    });
}

// ─── Histórico (timeline de auditoria) ───────────────────────────────────────

/** Rótulos amigáveis das ações de auditoria do agendamento. */
const ACTION_LABELS: Record<string, string> = {
    create: 'Agendamento criado',
    created: 'Agendamento criado',
    update: 'Agendamento atualizado',
    updated: 'Agendamento atualizado',
    cancel: 'Agendamento cancelado',
    cancelled: 'Agendamento cancelado',
    generate_os: 'O.S. gerada',
    os_generated: 'O.S. gerada',
};

function actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

function HistoryTimeline({
    items,
    loading,
}: {
    items: AppointmentHistoryEntry[];
    loading: boolean;
}) {
    if (loading) {
        return (
            <View className="gap-4">
                {[0, 1, 2].map((i) => (
                    <View key={i} className="flex-row gap-3">
                        <Skeleton width={14} height={14} radius={7} />
                        <View className="flex-1 gap-1.5">
                            <Skeleton width="60%" height={14} />
                            <Skeleton width="40%" height={12} />
                        </View>
                    </View>
                ))}
            </View>
        );
    }

    if (items.length === 0) {
        return (
            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                Nenhum registro de histórico.
            </Text>
        );
    }

    return (
        <View accessibilityRole="list">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                const isLatest = index === 0;
                return (
                    <View key={item.id} accessibilityRole="text" className="flex-row gap-3">
                        <View className="items-center">
                            <View
                                style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: 7,
                                    backgroundColor: isLatest ? '#F5B800' : '#D0D5DD',
                                }}
                            />
                            {!isLast ? (
                                <View className="my-0.5 w-px flex-1 bg-neutral-200 dark:bg-dark-border" />
                            ) : null}
                        </View>
                        <View className={isLast ? 'flex-1 pb-0' : 'flex-1 pb-5'}>
                            <Text
                                className={`font-sans-semibold text-sm ${
                                    isLatest
                                        ? 'text-primary-700 dark:text-brand'
                                        : 'text-neutral-800 dark:text-dark-text'
                                }`}
                            >
                                {actionLabel(item.action)}
                            </Text>
                            <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                {`${item.user_name ?? 'Sistema'} · ${formatDateTimeBR(item.created_at)}`}
                            </Text>
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

// ─── Helpers de apresentação ────────────────────────────────────────────────

function vehicleLabel(a: Appointment): string {
    return [a.vehicle_model, a.vehicle_color].filter(Boolean).join(' · ') || '—';
}

/** Nome do serviço de uma entrada de película (alinha por índice em service_names). */
function serviceNameFor(a: Appointment, serviceId: number, idx: number): string {
    const ids = a.service_ids ?? [];
    const pos = ids.indexOf(serviceId);
    const names = a.service_names ?? [];
    if (pos >= 0 && names[pos]) return names[pos];
    if (names[idx]) return names[idx];
    return `Serviço ${serviceId}`;
}

function StatusBadge({
    label,
    color,
    bg,
    dot,
}: {
    label: string;
    color: string;
    bg: string;
    dot: string;
}) {
    return (
        <View
            className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ backgroundColor: bg }}
        >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
            <Text className="font-sans-semibold text-[11px]" style={{ color }}>
                {label}
            </Text>
        </View>
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

function Chip({ label }: { label: string }) {
    return (
        <View className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-dark-elevated">
            <Text className="font-sans-medium text-[11px] text-neutral-500 dark:text-dark-text-muted">
                {label}
            </Text>
        </View>
    );
}

function Empty({ text }: { text: string }) {
    return <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">{text}</Text>;
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
