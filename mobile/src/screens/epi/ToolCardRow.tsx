import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { formatDateBR } from '@/utils/formatDate';
import type { ToolCard } from '@/types/materialRequest.types';

/**
 * Card de recebimento de ferramentas (Controle de EPIs) — DERIVADO no backend
 * como (pedido × funcionário). Compartilhado pelas abas Pendências
 * (`ToolPendingTab`) e Recebimentos (`ToolReceivedTab`).
 *
 * A AÇÃO do rodapé é recebida por prop (`action`): a aba Pendências injeta
 * "Registrar recebimento"; a aba Recebimentos injeta "Ver comprovante". Sem
 * `action`, o card fica só de leitura.
 */

export interface ToolCardAction {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
}

export function ToolCardRow({ card, action }: { card: ToolCard; action?: ToolCardAction }) {
    const isPending = card.status === 'pendente';
    return (
        <View className="rounded-2xl border border-neutral-100 bg-white p-4 dark:border-dark-border-soft dark:bg-dark-surface">
            <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                    <Text
                        className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {card.employee_name ?? `Funcionário ${card.employee_id}`}
                    </Text>
                    <View className="mt-0.5 flex-row flex-wrap items-center gap-x-3 gap-y-0.5">
                        <View className="flex-row items-center gap-1">
                            <Ionicons name="storefront-outline" size={12} color="#98A2B3" />
                            <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                {card.store_name ?? `Loja ${card.store_id}`}
                            </Text>
                        </View>
                        <View className="flex-row items-center gap-1">
                            <Ionicons name="calendar-outline" size={12} color="#98A2B3" />
                            <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                {formatDateBR(card.request_date)}
                            </Text>
                        </View>
                    </View>
                </View>
                {isPending ? (
                    <View className="rounded-full bg-warning-soft px-2 py-0.5">
                        <Text className="font-sans-semibold text-[11px] text-warning">Pendente</Text>
                    </View>
                ) : (
                    <View className="flex-row items-center gap-1">
                        <Ionicons name="checkmark-circle" size={14} color="#067647" />
                        <Text className="font-sans-semibold text-[11px] text-success">
                            Recebido
                            {card.received_at ? ` · ${formatDateBR(card.received_at.slice(0, 10))}` : ''}
                        </Text>
                    </View>
                )}
            </View>

            <View className="mt-3 gap-1 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-dark-elevated">
                {card.items.map((it) => (
                    <View key={it.id} className="flex-row items-center gap-1.5">
                        <Ionicons name="build-outline" size={13} color="#98A2B3" />
                        <Text className="font-sans-medium text-sm text-neutral-700 dark:text-dark-text">
                            {it.name}
                        </Text>
                        <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            × {it.quantity}
                        </Text>
                        {it.notes ? (
                            <Text
                                numberOfLines={1}
                                className="flex-1 font-sans text-xs italic text-neutral-400 dark:text-dark-text-muted"
                            >
                                — {it.notes}
                            </Text>
                        ) : null}
                    </View>
                ))}
            </View>

            {action ? (
                <View className="mt-3">
                    <Button
                        title={action.label}
                        icon={action.icon}
                        size="sm"
                        fullWidth={false}
                        onPress={action.onPress}
                    />
                </View>
            ) : null}
        </View>
    );
}
