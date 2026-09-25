import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { buildMonthGrid } from '@/utils/monthCalendar';
import { getAppointmentStatusConfig, DEPARTMENT_LABELS } from '@/constants/scheduling';
import type { Appointment } from '@/types/scheduling.types';

export interface CalendarMonthViewProps {
    appointments: Appointment[];
    currentDate: Date;
    onNavigate: (d: Date) => void;
    onDayPress: (dateStr: string) => void;
    onCardPress: (appt: Appointment) => void;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];
const MAX_CARDS_PER_DAY = 2;

/** YYYY-MM-DD de hoje em horário LOCAL (sem UTC shift). */
function todayLocalStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Visão Mês do Agendamento (paridade parcial com o web CalendarMonthView).
 * Grid 6×7 via `buildMonthGrid`; até 2 mini-cards por dia + "+N mais". Tocar no
 * número do dia dispara `onDayPress(dateStr)`; tocar num card, `onCardPress`.
 */
export function CalendarMonthView({
    appointments,
    currentDate,
    onNavigate,
    onDayPress,
    onCardPress,
}: CalendarMonthViewProps) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = todayLocalStr();

    const byDate = useMemo(() => {
        const map = new Map<string, Appointment[]>();
        for (const a of appointments) {
            const key = (a.delivery_date ?? '').slice(0, 10);
            if (!key) continue;
            const arr = map.get(key);
            if (arr) arr.push(a);
            else map.set(key, [a]);
        }
        return map;
    }, [appointments]);

    const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);

    return (
        <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
            {/* Cabeçalho de navegação */}
            <View className="flex-row items-center justify-between px-4 py-3">
                <Text className="font-display-bold text-lg text-neutral-900 dark:text-dark-text">
                    {MONTHS[month]} {year}
                </Text>
                <View className="flex-row items-center gap-1">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Mês anterior"
                        onPress={() => onNavigate(new Date(year, month - 1, 1))}
                        className="h-9 w-9 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                    >
                        <Ionicons name="chevron-back" size={18} color="#667085" />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Hoje"
                        onPress={() => onNavigate(new Date())}
                        className="h-9 items-center justify-center rounded-full px-3 active:bg-neutral-100 dark:active:bg-dark-elevated"
                    >
                        <Text className="font-sans-semibold text-xs text-neutral-600 dark:text-dark-text">
                            Hoje
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Próximo mês"
                        onPress={() => onNavigate(new Date(year, month + 1, 1))}
                        className="h-9 w-9 items-center justify-center rounded-full active:bg-neutral-100 dark:active:bg-dark-elevated"
                    >
                        <Ionicons name="chevron-forward" size={18} color="#667085" />
                    </Pressable>
                </View>
            </View>

            {/* Cabeçalhos de dia da semana */}
            <View className="flex-row px-2">
                {WEEKDAYS.map((w) => (
                    <View key={w} className="flex-1 items-center py-1.5">
                        <Text className="font-sans-semibold text-[10px] uppercase text-neutral-400 dark:text-dark-text-muted">
                            {w}
                        </Text>
                    </View>
                ))}
            </View>

            {/* Grade de dias — 6 linhas de 7 */}
            <View className="flex-row flex-wrap px-2">
                {cells.map((cell) => {
                    const isToday = cell.dateStr === today;
                    const dayAppts = byDate.get(cell.dateStr) ?? [];
                    const visible = dayAppts.slice(0, MAX_CARDS_PER_DAY);
                    const overflow = dayAppts.length - visible.length;
                    return (
                        <View
                            key={cell.dateStr}
                            style={{ width: `${100 / 7}%`, minHeight: 84 }}
                            className={`border border-neutral-100 p-1 dark:border-dark-border-soft/50 ${
                                cell.currentMonth ? '' : 'opacity-30'
                            } ${isToday ? 'bg-amber-50 dark:bg-dark-elevated' : ''}`}
                        >
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Dia ${cell.day}`}
                                disabled={!cell.currentMonth}
                                onPress={() => onDayPress(cell.dateStr)}
                                className={`mb-0.5 h-5 w-5 items-center justify-center rounded-full ${
                                    isToday ? 'bg-brand' : ''
                                }`}
                            >
                                <Text
                                    className={`text-[11px] ${
                                        isToday
                                            ? 'font-sans-bold text-brand-black'
                                            : 'font-sans-medium text-neutral-700 dark:text-dark-text'
                                    }`}
                                >
                                    {cell.day}
                                </Text>
                            </Pressable>

                            {visible.map((a) => {
                                const cfg = getAppointmentStatusConfig(a.display_status);
                                return (
                                    <Pressable
                                        key={a.id}
                                        accessibilityRole="button"
                                        onPress={() => onCardPress(a)}
                                        className="mb-0.5 rounded px-1 py-0.5"
                                        style={{ backgroundColor: cfg.cardBg, borderLeftWidth: 2, borderLeftColor: cfg.border }}
                                    >
                                        <Text numberOfLines={1} className="font-sans-semibold text-[9px] text-neutral-800 dark:text-dark-text">
                                            {a.vehicle_model ?? 'Veículo'}
                                        </Text>
                                        <Text numberOfLines={1} className="font-sans text-[8px] text-neutral-500 dark:text-dark-text-muted">
                                            {DEPARTMENT_LABELS[a.department] ?? a.department} · {a.vehicle_plate}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                            {overflow > 0 ? (
                                <Text className="pl-0.5 font-sans text-[9px] text-neutral-400 dark:text-dark-text-muted">
                                    +{overflow} mais
                                </Text>
                            ) : null}
                        </View>
                    );
                })}
            </View>
        </ScrollView>
    );
}
