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
import { DateField } from '@/components/ui/DateField';
import { useTheme } from '@/theme';
import { DEPARTMENTS } from '@/constants/service-orders';
import type { AppointmentFilters } from '@/types/scheduling.types';

/**
 * Sheet de filtros da lista de Agendamentos (AGD-02).
 *
 * Filtros: departamento (único), categoria de serviço (único), período
 * início/fim. A loja é gerida fora pelo StoreSelector global; busca/cancelados
 * também ficam fora do sheet. Mantém um rascunho interno e só aplica em
 * "Aplicar"; "Limpar" zera tudo.
 */

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
    { value: 'insulfilm', label: 'Insulfilm' },
    { value: 'ppf', label: 'PPF' },
    { value: 'pelicula_seguranca', label: 'Película de Segurança' },
    { value: 'estetica', label: 'Estética' },
];

export interface SchedulingFilterSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface SchedulingFilterSheetProps {
    /** Filtros aplicados atualmente (department/service_category/date_from/date_to). */
    value: AppointmentFilters;
    /** Aplica os filtros (sem `search`/`store_id`, geridos fora). */
    onApply: (filters: AppointmentFilters) => void;
}

interface Draft {
    department: string | undefined;
    service_category: string | undefined;
    date_from: string;
    date_to: string;
}

function toDraft(value: AppointmentFilters): Draft {
    return {
        department: value.department,
        service_category: value.service_category,
        date_from: value.date_from ?? '',
        date_to: value.date_to ?? '',
    };
}

export const SchedulingFilterSheet = forwardRef<SchedulingFilterSheetRef, SchedulingFilterSheetProps>(
    function SchedulingFilterSheet({ value, onApply }, ref) {
        const modalRef = useRef<BottomSheetModal>(null);
        const insets = useSafeAreaInsets();
        const { isDark, colors } = useTheme();
        const [draft, setDraft] = useState<Draft>(() => toDraft(value));

        useImperativeHandle(ref, () => ({
            present: () => {
                setDraft(toDraft(value));
                modalRef.current?.present();
            },
            dismiss: () => modalRef.current?.dismiss(),
        }));

        useEffect(() => {
            setDraft(toDraft(value));
        }, [value]);

        const renderBackdrop = (props: BottomSheetBackdropProps) => (
            <BottomSheetBackdrop
                {...props}
                appearsOnIndex={0}
                disappearsOnIndex={-1}
                pressBehavior="close"
            />
        );

        const apply = () => {
            onApply({
                department: draft.department,
                service_category: draft.service_category,
                date_from: draft.date_from.trim() || undefined,
                date_to: draft.date_to.trim() || undefined,
            });
            modalRef.current?.dismiss();
        };

        const clear = () => {
            setDraft({
                department: undefined,
                service_category: undefined,
                date_from: '',
                date_to: '',
            });
        };

        return (
            <BottomSheetModal
                ref={modalRef}
                enableDynamicSizing
                maxDynamicContentSize={760}
                bottomInset={insets.bottom}
                backdropComponent={renderBackdrop}
                handleIndicatorStyle={{ backgroundColor: isDark ? '#555555' : '#D0D5DD' }}
                backgroundStyle={{ backgroundColor: colors.surface }}
            >
                <BottomSheetView>
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
                        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
                        keyboardShouldPersistTaps="handled"
                    >
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

                        {/* Categoria (único) */}
                        <FilterLabel>Categoria</FilterLabel>
                        <View className="mb-5 flex-row flex-wrap gap-2">
                            <ChipToggle
                                label="Todas"
                                active={draft.service_category === undefined}
                                onPress={() =>
                                    setDraft((d) => ({ ...d, service_category: undefined }))
                                }
                            />
                            {CATEGORY_OPTIONS.map((cat) => (
                                <ChipToggle
                                    key={cat.value}
                                    label={cat.label}
                                    active={draft.service_category === cat.value}
                                    onPress={() =>
                                        setDraft((d) => ({
                                            ...d,
                                            service_category:
                                                d.service_category === cat.value ? undefined : cat.value,
                                        }))
                                    }
                                />
                            ))}
                        </View>

                        {/* Datas */}
                        <FilterLabel>Período</FilterLabel>
                        <View className="flex-row gap-3">
                            <View className="flex-1">
                                <DateField
                                    label="De"
                                    value={draft.date_from}
                                    onChange={(iso) => setDraft((d) => ({ ...d, date_from: iso }))}
                                />
                            </View>
                            <View className="flex-1">
                                <DateField
                                    label="Até"
                                    value={draft.date_to}
                                    onChange={(iso) => setDraft((d) => ({ ...d, date_to: iso }))}
                                />
                            </View>
                        </View>

                        {/* Ação dentro do scroll → nunca fica atrás da barra do Android. */}
                        <View className="mt-5">
                            <Button title="Aplicar filtros" icon="checkmark" onPress={apply} />
                        </View>
                    </ScrollView>
                </BottomSheetView>
            </BottomSheetModal>
        );
    }
);

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
                active ? 'bg-brand' : 'bg-neutral-100 dark:bg-dark-elevated',
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
