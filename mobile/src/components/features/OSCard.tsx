import { memo } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { OSStatusBadge } from '@/components/ui/OSStatusBadge';
import { DEPARTMENTS_MAP } from '@/constants/service-orders';
import { formatDateBR } from '@/utils/formatDate';
import type { ServiceOrder, ServiceOrderStatus } from '@/types/service-order.types';

/**
 * OS-04 — Card de Ordem de Serviço (presentational, memoizado para FlashList).
 *
 * Replica o card do Figma `02-ordens-servico-lista.png`:
 * - faixa colorida no topo indicando o status;
 * - cabeçalho `OS {external_os_number ?? "—"}` + `OSStatusBadge`;
 * - grade 2 colunas (Placa / Depto / Loja / Veículo / Data);
 * - chips de flags (Galpão / Retorno / Cortesia);
 * - rodapé com Visualizar (secundário) + Editar (primário, condicional a `canEdit`).
 *
 * Não há campo de chassi no modelo mobile — substituímos por "Veículo".
 */

export interface OSCardProps {
    order: ServiceOrder;
    onPressView: () => void;
    onPressEdit?: () => void;
    /** Mostra/habilita o botão Editar. Default: false. */
    canEdit?: boolean;
}

/** Cor da faixa superior por status (hex — usado em style, não em className). */
const STRIPE_COLOR: Record<ServiceOrderStatus, string> = {
    doing: '#F5B800', // âmbar
    ready: '#12B76A', // verde
    wrong: '#F04438', // vermelho
    waiting: '#D0D5DD', // neutro/cinza
    cancelled: '#475467', // neutro escuro
    duplicate: '#7A5AF8', // roxo
};

function OSCardComponent({ order, onPressView, onPressEdit, canEdit = false }: OSCardProps) {
    const vehicle = [order.vehicle_model, order.vehicle_color].filter(Boolean).join(' · ') || '—';
    const dateValue = order.service_date ?? order.entry_time;
    // Nº de O.S. da concessionária (external_os_number). Quando não houver,
    // exibe "—" — NUNCA o número interno do sistema (order_number).
    const osNumber = order.external_os_number || '—';

    return (
        <View className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm dark:border-dark-border-soft dark:bg-dark-surface">
            {/* Faixa de status */}
            <View
                accessible={false}
                style={{ height: 5, backgroundColor: STRIPE_COLOR[order.status] }}
            />

            <View className="p-4">
                {/* Cabeçalho */}
                <View className="mb-3 flex-row items-start justify-between gap-2">
                    <Text
                        className="flex-1 font-display-bold text-base text-neutral-900 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {`OS ${osNumber}`}
                    </Text>
                    <OSStatusBadge status={order.status} size="sm" />
                </View>

                {/* Grade 2 colunas */}
                <View className="flex-row flex-wrap">
                    <Field label="Placa" value={order.plate} mono />
                    <Field label="Depto" value={DEPARTMENTS_MAP[order.department] ?? '—'} />
                    <Field label="Loja" value={order.location_name || '—'} />
                    <Field label="Data" value={formatDateBR(dateValue)} />
                    <Field label="Veículo" value={vehicle} full />
                </View>

                {/* Chips de flags */}
                {(order.is_galpon || order.is_return || order.is_courtesy) && (
                    <View className="mt-2 flex-row flex-wrap gap-1.5">
                        {order.is_galpon ? <Chip label="Galpão" /> : null}
                        {order.is_return ? <Chip label="Retorno" /> : null}
                        {order.is_courtesy ? <Chip label="Cortesia" /> : null}
                    </View>
                )}

                {/* Rodapé */}
                <View className="mt-4 flex-row gap-2">
                    <View className="flex-1">
                        <Button
                            title="Visualizar"
                            icon="eye-outline"
                            variant="secondary"
                            size="sm"
                            onPress={onPressView}
                        />
                    </View>
                    {canEdit && onPressEdit ? (
                        <View className="flex-1">
                            <Button
                                title="Editar"
                                icon="create-outline"
                                variant="primary"
                                size="sm"
                                onPress={onPressEdit}
                            />
                        </View>
                    ) : null}
                </View>
            </View>
        </View>
    );
}

interface FieldProps {
    label: string;
    value: string;
    mono?: boolean;
    /** Ocupa a linha inteira (em vez de 1/2). */
    full?: boolean;
}

function Field({ label, value, mono = false, full = false }: FieldProps) {
    return (
        <View className={full ? 'mt-2 w-full' : 'mt-2 w-1/2 pr-2'}>
            <Text className="font-sans text-[11px] uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text
                className={`font-sans-semibold text-sm text-neutral-800 dark:text-dark-text ${
                    mono ? 'font-mono tracking-wider' : ''
                }`}
                numberOfLines={1}
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

export const OSCard = memo(OSCardComponent);
