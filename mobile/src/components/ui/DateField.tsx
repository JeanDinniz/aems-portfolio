import { useState } from 'react';
import { Keyboard, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

/**
 * Campo de DATA que abre o calendário nativo (sem teclado).
 *
 * Substitui a digitação livre "AAAA-MM-DD" nos filtros — evita o teclado cobrir
 * a tela dentro de bottom sheets e é mais fácil de usar. Guarda/emite a data no
 * formato ISO "AAAA-MM-DD" (compatível com os filtros/backend); exibe em pt-BR
 * (DD/MM/AAAA). `value` vazio = sem data. Toque no "x" limpa.
 */

/** "AAAA-MM-DD" → Date local (meio-dia evita drift de fuso). */
function isoToDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

/** Date → "AAAA-MM-DD" (componentes locais). */
function dateToISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" para exibição. */
function displayBR(iso: string): string {
    const [y, m, d] = iso.split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

export interface DateFieldProps {
    label?: string;
    /** Data selecionada em ISO "AAAA-MM-DD" (ou vazio). */
    value?: string;
    /** Emite a nova data ISO, ou '' quando limpa. */
    onChange: (iso: string) => void;
    /** Texto quando não há data selecionada. */
    placeholder?: string;
}

export function DateField({
    label,
    value,
    onChange,
    placeholder = 'Selecionar data',
}: DateFieldProps) {
    const [show, setShow] = useState(false);
    const has = !!value;

    return (
        <View className="mb-4">
            {label ? (
                <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                    {label}
                </Text>
            ) : null}

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label ? `${label}: ${has ? displayBR(value!) : placeholder}` : undefined}
                onPress={() => {
                    Keyboard.dismiss();
                    setShow(true);
                }}
                className="min-h-[48px] flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 active:opacity-80 dark:border-dark-border-strong dark:bg-dark-input"
            >
                <Text
                    className={[
                        'flex-1 font-sans text-base',
                        has
                            ? 'text-neutral-900 dark:text-dark-text'
                            : 'text-neutral-400 dark:text-dark-text-muted',
                    ].join(' ')}
                    numberOfLines={1}
                >
                    {has ? displayBR(value!) : placeholder}
                </Text>
                {has ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Limpar data"
                        hitSlop={8}
                        onPress={() => onChange('')}
                        className="p-0.5 active:opacity-70"
                    >
                        <Ionicons name="close-circle" size={18} color="#98A2B3" />
                    </Pressable>
                ) : (
                    <Ionicons name="calendar-outline" size={18} color="#98A2B3" />
                )}
            </Pressable>

            {show ? (
                <DateTimePicker
                    value={has ? isoToDate(value!) : new Date()}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(event: DateTimePickerEvent, date?: Date) => {
                        setShow(false);
                        if (event.type !== 'dismissed' && date) {
                            onChange(dateToISO(date));
                        }
                    }}
                />
            ) : null}
        </View>
    );
}
