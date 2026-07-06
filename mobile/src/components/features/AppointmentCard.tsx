import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { APPOINTMENT_STATUS_CONFIG, DEPARTMENT_LABELS } from '@/constants/scheduling';
import { formatClock } from '@/utils/formatDate';
import type { Appointment } from '@/types/scheduling.types';

/**
 * AGD-02 — Card de Agendamento (presentational, memoizado para FlashList).
 *
 * Espelha o OSCard, mas com a paleta SEMPRE vinda de
 * `APPOINTMENT_STATUS_CONFIG[display_status]`:
 *  - faixa LATERAL colorida (border) + fundo suave (cardBg) por status;
 *  - cabeçalho: placa (monospace) + label do status (colorido);
 *  - linha de chips com os `service_names` (até 3 + "·N");
 *  - rodapé: consultor + departamento + horário (delivery_time);
 *  - badges Galpão / Cortesia / Retorno.
 *
 * Toda a área é tocável → abre o detalhe.
 */

export interface AppointmentCardProps {
    appointment: Appointment;
    onPress: () => void;
}

const MAX_SERVICE_CHIPS = 3;

function AppointmentCardComponent({ appointment, onPress }: AppointmentCardProps) {
    const cfg = APPOINTMENT_STATUS_CONFIG[appointment.display_status];
    const time = formatClock(appointment.delivery_time);
    const services = appointment.service_names ?? [];
    const extraServices = services.length - MAX_SERVICE_CHIPS;
    const department = DEPARTMENT_LABELS[appointment.department] ?? appointment.department;
    const consultant = appointment.consultant_name?.trim() || 'Sem consultor';

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Agendamento ${appointment.vehicle_plate}, ${cfg.label}`}
            onPress={onPress}
            className="flex-row overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm active:opacity-90 dark:border-dark-border-soft dark:bg-dark-surface"
        >
            {/* Faixa lateral de status */}
            <View accessible={false} style={{ width: 5, backgroundColor: cfg.border }} />

            <View className="flex-1 p-4">
                {/* Cabeçalho: placa + status */}
                <View className="mb-2 flex-row items-center justify-between gap-2">
                    <Text
                        className="flex-1 font-mono text-base font-semibold tracking-wider text-neutral-900 dark:text-dark-text"
                        numberOfLines={1}
                    >
                        {appointment.vehicle_plate || '—'}
                    </Text>
                    <View
                        className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{ backgroundColor: cfg.cardBg }}
                    >
                        <View
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: cfg.dot,
                            }}
                        />
                        <Text className="font-sans-semibold text-[11px]" style={{ color: cfg.color }}>
                            {cfg.label}
                        </Text>
                    </View>
                </View>

                {/* Veículo / OS externa */}
                <Text
                    className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted"
                    numberOfLines={1}
                >
                    {[appointment.vehicle_model, appointment.vehicle_color]
                        .filter(Boolean)
                        .join(' · ') || department}
                    {appointment.external_os_number ? `  ·  OS ${appointment.external_os_number}` : ''}
                </Text>

                {/* Chips de serviços */}
                {services.length > 0 ? (
                    <View className="mt-2.5 flex-row flex-wrap gap-1.5">
                        {services.slice(0, MAX_SERVICE_CHIPS).map((name, idx) => (
                            <Chip key={`${name}-${idx}`} label={name} />
                        ))}
                        {extraServices > 0 ? <Chip label={`+${extraServices}`} /> : null}
                    </View>
                ) : null}

                {/* Rodapé: consultor · depto · horário */}
                <View className="mt-3 flex-row items-center gap-3">
                    <View className="flex-1 flex-row items-center gap-1.5">
                        <Ionicons name="person-outline" size={14} color="#98A2B3" />
                        <Text
                            className="flex-1 font-sans text-xs text-neutral-500 dark:text-dark-text-muted"
                            numberOfLines={1}
                        >
                            {consultant}
                        </Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                        <Ionicons name="time-outline" size={14} color="#98A2B3" />
                        <Text className="font-sans-semibold text-xs text-neutral-600 dark:text-dark-text">
                            {time}
                        </Text>
                    </View>
                </View>

                {/* Badges */}
                {(appointment.is_galpon || appointment.is_courtesy || appointment.is_return) && (
                    <View className="mt-2 flex-row flex-wrap gap-1.5">
                        {appointment.is_galpon ? <Badge label="Galpão" /> : null}
                        {appointment.is_courtesy ? <Badge label="Cortesia" /> : null}
                        {appointment.is_return ? <Badge label="Retorno" /> : null}
                    </View>
                )}
            </View>
        </Pressable>
    );
}

function Chip({ label }: { label: string }) {
    return (
        <View className="rounded-md bg-neutral-100 px-2 py-1 dark:bg-dark-elevated">
            <Text
                className="font-sans-medium text-[11px] text-neutral-600 dark:text-dark-text-muted"
                numberOfLines={1}
            >
                {label}
            </Text>
        </View>
    );
}

function Badge({ label }: { label: string }) {
    return (
        <View className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-dark-elevated">
            <Text className="font-sans-medium text-[11px] text-neutral-500 dark:text-dark-text-muted">
                {label}
            </Text>
        </View>
    );
}

export const AppointmentCard = memo(AppointmentCardComponent);
