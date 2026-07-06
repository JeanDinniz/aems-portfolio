import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ROLL_COLOR_CONFIG } from '@/constants/inventory';
import type { FilmRoll } from '@/services/api/inventory.service';

/**
 * INV-02 — Card de bobina (presentational, memoizado para FlashList).
 *
 * A paleta vem SEMPRE de `ROLL_COLOR_CONFIG[roll.color]` (cor calculada pelo
 * backend — o app não recalcula):
 *  - faixa LATERAL colorida (border) por cor;
 *  - cabeçalho: `visual_id` (monospace) + badge de status (label por cor);
 *  - tipo de película + tonalidade;
 *  - loja;
 *  - barra de metragem (remaining/total) + texto "X.Xm / Y.Ym".
 *
 * Toda a área é tocável → abre o detalhe.
 */

export interface RollCardProps {
    roll: FilmRoll;
    onPress: () => void;
}

function clampPct(remaining: number, total: number): number {
    if (!total || total <= 0) return 0;
    const pct = (remaining / total) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return pct;
}

function RollCardComponent({ roll, onPress }: RollCardProps) {
    const cfg = ROLL_COLOR_CONFIG[roll.color] ?? ROLL_COLOR_CONFIG.blue;
    const pct = clampPct(roll.remaining_meters, roll.total_meters);
    const metersText = `${roll.remaining_meters.toFixed(1)}m / ${roll.total_meters.toFixed(1)}m`;
    const filmLabel = roll.tonality
        ? `${roll.film_type_name} · ${roll.tonality}`
        : roll.film_type_name;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Bobina ${roll.visual_id}, ${cfg.label}`}
            onPress={onPress}
            className="flex-row overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm active:opacity-90 dark:border-dark-border-soft dark:bg-dark-surface"
        >
            {/* Faixa lateral de status (cor do backend) */}
            <View accessible={false} style={{ width: 5, backgroundColor: cfg.solid }} />

            <View className="flex-1 p-4">
                {/* Cabeçalho: visual_id + badge de status */}
                <View className="mb-1.5 flex-row items-center justify-between gap-2">
                    <Text
                        className="flex-1 font-mono text-base font-semibold tracking-wider text-neutral-900 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {roll.visual_id}
                    </Text>
                    <View
                        className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{ backgroundColor: cfg.badgeBg }}
                    >
                        <View
                            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cfg.solid }}
                        />
                        <Text className="font-sans-semibold text-[11px]" style={{ color: cfg.badgeFg }}>
                            {cfg.label}
                        </Text>
                    </View>
                </View>

                {/* Tipo + tonalidade */}
                <Text
                    className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text"
                    numberOfLines={1}
                >
                    {filmLabel}
                </Text>

                {/* Loja */}
                <View className="mt-1.5 flex-row items-center gap-1.5">
                    <Ionicons name="storefront-outline" size={14} color="#98A2B3" />
                    <Text
                        className="flex-1 font-sans text-xs text-neutral-500 dark:text-dark-text-muted"
                        numberOfLines={1}
                    >
                        {roll.store_name || `Loja ${roll.store_id}`}
                    </Text>
                </View>

                {/* Barra de metragem */}
                <View className="mt-3">
                    <View
                        className="h-2 w-full overflow-hidden rounded-full"
                        style={{ backgroundColor: cfg.track }}
                        accessible={false}
                    >
                        <View
                            style={{
                                width: `${pct}%`,
                                height: '100%',
                                borderRadius: 999,
                                backgroundColor: cfg.solid,
                            }}
                        />
                    </View>
                    <Text className="mt-1.5 font-sans-semibold text-xs text-neutral-600 dark:text-dark-text">
                        {metersText}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

export const RollCard = memo(RollCardComponent);
