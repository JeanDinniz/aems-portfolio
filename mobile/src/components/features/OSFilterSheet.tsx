import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useTheme } from '@/theme';
import { DEPARTMENTS } from '@/constants/service-orders';
import type { ServiceOrderFilters } from '@/types/service-order.types';

/**
 * Sheet de filtros da lista de O.S. (OS-02).
 *
 * Filtros: status[] (multi), departamento (único), data início/fim, flags
 * (galpão/retorno/cortesia → `flag[]`). Mantém um rascunho interno e só aplica
 * em "Aplicar"; "Limpar" zera tudo.
 *
 * ⚠️ Status: o backend espera os valores do BACKEND
 * (`waiting`|`in_progress`|`completed`|`wrong`|`cancelled`) — o service de O.S.
 * faz `append` direto de `filters.status`. Por isso enviamos os valores do
 * backend (mesma estratégia do web `ServiceOrdersPage`), exibindo rótulos pt-BR.
 */

/** Valores de status (backend) + rótulo — espelha o web StatusMultiSelect. */
const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: 'waiting', label: 'Aguardando' },
    { value: 'in_progress', label: 'Em Andamento' },
    { value: 'completed', label: 'Finalizado' },
    { value: 'duplicate', label: 'Duplicado' },
    { value: 'wrong', label: 'Lançado Errado' },
    { value: 'cancelled', label: 'Cancelada' },
];

const FLAG_OPTIONS: { value: string; label: string }[] = [
    { value: 'galpon', label: 'Galpão' },
    { value: 'return', label: 'Retorno' },
    { value: 'courtesy', label: 'Cortesia' },
];

export interface OSFilterSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface OSFilterSheetProps {
    /** Filtros aplicados atualmente (status/department/date_from/date_to/flag). */
    value: ServiceOrderFilters;
    /** Aplica os filtros (sem `search`/`store_id`, geridos fora). */
    onApply: (filters: ServiceOrderFilters) => void;
}

interface Draft {
    status: string[];
    department: string | undefined;
    date_from: string;
    date_to: string;
    flag: string[];
}

function toDraft(value: ServiceOrderFilters): Draft {
    const status = Array.isArray(value.status)
        ? value.status
        : value.status
          ? [value.status]
          : [];
    return {
        status,
        department: value.department,
        date_from: value.date_from ?? '',
        date_to: value.date_to ?? '',
        flag: value.flag ?? [],
    };
}

function toggle<T>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((v) => v !== item) : [...list, item];
}

export const OSFilterSheet = forwardRef<OSFilterSheetRef, OSFilterSheetProps>(function OSFilterSheet(
    { value, onApply },
    ref
) {
    const modalRef = useRef<BottomSheetModal>(null);
    const insets = useSafeAreaInsets();
    const { isDark, colors } = useTheme();
    const [draft, setDraft] = useState<Draft>(() => toDraft(value));

    useImperativeHandle(ref, () => ({
        present: () => {
            // Reidrata o rascunho com os filtros atuais ao abrir.
            setDraft(toDraft(value));
            modalRef.current?.present();
        },
        dismiss: () => modalRef.current?.dismiss(),
    }));

    // Mantém o rascunho em sincronia se o filtro externo mudar enquanto fechado.
    useEffect(() => {
        setDraft(toDraft(value));
    }, [value]);

    const renderBackdrop = (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    );

    const apply = () => {
        onApply({
            status: draft.status.length > 0 ? draft.status : undefined,
            department: draft.department,
            date_from: draft.date_from.trim() || undefined,
            date_to: draft.date_to.trim() || undefined,
            flag: draft.flag.length > 0 ? draft.flag : undefined,
        });
        modalRef.current?.dismiss();
    };

    const clear = () => {
        setDraft({ status: [], department: undefined, date_from: '', date_to: '', flag: [] });
    };

    return (
        <BottomSheetModal
            ref={modalRef}
            enableDynamicSizing
            maxDynamicContentSize={680}
            backdropComponent={renderBackdrop}
            handleIndicatorStyle={{ backgroundColor: isDark ? '#555555' : '#D0D5DD' }}
            backgroundStyle={{ backgroundColor: colors.surface }}
        >
            <BottomSheetView style={{ paddingBottom: insets.bottom + 16 }}>
                <View className="flex-row items-center justify-between border-b border-neutral-100 px-5 pb-3 pt-1 dark:border-dark-border-soft">
                    <Text className="font-display text-lg text-neutral-900 dark:text-dark-text">
                        Filtros
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Limpar filtros"
                        onPress={clear}
                        className="px-2 py-1 active:opacity-70"
                    >
                        <Text className="font-sans-semibold text-sm text-primary-700 dark:text-brand">
                            Limpar
                        </Text>
                    </Pressable>
                </View>

                <ScrollView
                    className="px-5"
                    contentContainerStyle={{ paddingTop: 16, paddingBottom: 8 }}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Status (multi) */}
                    <FilterLabel>Status</FilterLabel>
                    <View className="mb-5 flex-row flex-wrap gap-2">
                        {STATUS_OPTIONS.map((opt) => (
                            <ChipToggle
                                key={opt.value}
                                label={opt.label}
                                active={draft.status.includes(opt.value)}
                                onPress={() =>
                                    setDraft((d) => ({ ...d, status: toggle(d.status, opt.value) }))
                                }
                            />
                        ))}
                    </View>

                    {/* Departamento (único) */}
                    <FilterLabel>Departamento</FilterLabel>
                    <View className="mb-5 flex-row flex-wrap gap-2">
                        <ChipToggle
                            label="Todos"
                            active={draft.department === undefined}
                            onPress={() => setDraft((d) => ({ ...d, department: undefined }))}
                        />
                        {DEPARTMENTS.map((dep) => (
                            <ChipToggle
                                key={dep.value}
                                label={dep.label}
                                active={draft.department === dep.value}
                                onPress={() =>
                                    setDraft((d) => ({
                                        ...d,
                                        department: d.department === dep.value ? undefined : dep.value,
                                    }))
                                }
                            />
                        ))}
                    </View>

                    {/* Datas */}
                    <FilterLabel>Período</FilterLabel>
                    <View className="flex-row gap-3">
                        <View className="flex-1">
                            <TextField
                                label="De"
                                placeholder="AAAA-MM-DD"
                                autoCapitalize="none"
                                autoCorrect={false}
                                value={draft.date_from}
                                onChangeText={(t) => setDraft((d) => ({ ...d, date_from: t }))}
                            />
                        </View>
                        <View className="flex-1">
                            <TextField
                                label="Até"
                                placeholder="AAAA-MM-DD"
                                autoCapitalize="none"
                                autoCorrect={false}
                                value={draft.date_to}
                                onChangeText={(t) => setDraft((d) => ({ ...d, date_to: t }))}
                            />
                        </View>
                    </View>

                    {/* Flags */}
                    <FilterLabel>Marcadores</FilterLabel>
                    <View className="mb-2 flex-row flex-wrap gap-2">
                        {FLAG_OPTIONS.map((opt) => (
                            <ChipToggle
                                key={opt.value}
                                label={opt.label}
                                active={draft.flag.includes(opt.value)}
                                onPress={() =>
                                    setDraft((d) => ({ ...d, flag: toggle(d.flag, opt.value) }))
                                }
                            />
                        ))}
                    </View>
                </ScrollView>

                <View className="px-5 pt-2">
                    <Button title="Aplicar filtros" icon="checkmark" onPress={apply} />
                </View>
            </BottomSheetView>
        </BottomSheetModal>
    );
});

function FilterLabel({ children }: { children: string }) {
    return (
        <Text className="mb-2 font-sans-semibold text-xs uppercase tracking-wide text-neutral-400 dark:text-dark-text-muted">
            {children}
        </Text>
    );
}

interface ChipToggleProps {
    label: string;
    active: boolean;
    onPress: () => void;
}

function ChipToggle({ label, active, onPress }: ChipToggleProps) {
    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            accessibilityLabel={label}
            onPress={onPress}
            className={[
                'min-h-[36px] flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 active:opacity-80',
                active
                    ? 'bg-brand'
                    : 'bg-neutral-100 dark:bg-dark-elevated',
            ].join(' ')}
        >
            {active ? <Ionicons name="checkmark" size={14} color="#1A1A1A" /> : null}
            <Text
                className={[
                    'font-sans-medium text-sm',
                    active ? 'text-brand-black' : 'text-neutral-600 dark:text-dark-text',
                ].join(' ')}
            >
                {label}
            </Text>
        </Pressable>
    );
}
