import { Text, View } from 'react-native';

import { Skeleton } from '@/components/ui/Skeleton';
import { STATUS_LABELS } from '@/constants/service-orders';
import { formatDateTimeBR } from '@/utils/formatDate';
import type { ServiceOrderStatus } from '@/types/service-order.types';

/**
 * OS-04 — Linha do tempo do histórico de status da O.S.
 *
 * ⚠️ `from_status`/`to_status` chegam em valores do BACKEND
 * ('waiting' | 'in_progress' | 'completed' | 'cancelled' | 'wrong').
 * Mapeamos in_progress→doing e completed→ready antes de aplicar STATUS_LABELS.
 */

export interface OSTimelineItem {
    id: number | string;
    from_status: string | null;
    to_status: string;
    changed_by_name: string | null;
    changed_at: string;
    notes: string | null;
}

export interface OSTimelineProps {
    items: OSTimelineItem[];
    loading?: boolean;
}

/** Converte status do backend → status do frontend (chave de STATUS_LABELS). */
function toFrontendStatus(backend: string | null): ServiceOrderStatus | null {
    if (!backend) return null;
    switch (backend) {
        case 'in_progress':
            return 'doing';
        case 'completed':
            return 'ready';
        case 'waiting':
        case 'cancelled':
        case 'wrong':
        case 'doing':
        case 'ready':
            return backend as ServiceOrderStatus;
        default:
            return null;
    }
}

function statusLabel(backend: string | null): string {
    const fe = toFrontendStatus(backend);
    return fe ? STATUS_LABELS[fe] : '—';
}

export function OSTimeline({ items, loading = false }: OSTimelineProps) {
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
                Nenhuma mudança de status registrada.
            </Text>
        );
    }

    return (
        <View accessibilityRole="list">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                // Primeira posição da lista = mudança mais recente (destaque âmbar).
                const isLatest = index === 0;

                return (
                    <View
                        key={item.id}
                        accessibilityRole="text"
                        className="flex-row gap-3"
                    >
                        {/* Trilho + bolinha */}
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

                        {/* Conteúdo */}
                        <View className={isLast ? 'flex-1 pb-0' : 'flex-1 pb-5'}>
                            <Text
                                className={`font-sans-semibold text-sm ${
                                    isLatest
                                        ? 'text-primary-700 dark:text-brand'
                                        : 'text-neutral-800 dark:text-dark-text'
                                }`}
                            >
                                {item.from_status
                                    ? `${statusLabel(item.from_status)} → ${statusLabel(item.to_status)}`
                                    : statusLabel(item.to_status)}
                            </Text>
                            <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                {`${item.changed_by_name ?? 'Sistema'} · ${formatDateTimeBR(item.changed_at)}`}
                            </Text>
                            {item.notes ? (
                                <Text className="mt-1 font-sans text-xs italic text-neutral-500 dark:text-dark-text-muted">
                                    {item.notes}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}
