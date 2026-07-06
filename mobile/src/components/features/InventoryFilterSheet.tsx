import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
import { useFilmTypes } from '@/hooks/useInventory';
import { useTheme } from '@/theme';
import { FILM_DEPARTMENT_OPTIONS, FILM_ROLL_STATUS_OPTIONS } from '@/constants/inventory';
import type {
    FilmDepartment,
    FilmRollStatus,
} from '@/services/api/inventory.service';

/**
 * Sheet de filtros da lista de bobinas (INV-02).
 *
 * Filtros: departamento (único), tipo de película (único — carregado via
 * `useFilmTypes` e filtrado pelo departamento escolhido), status (único) e a
 * flag galpão (`use_galpon_store`). A loja é gerida fora pelo StoreSelector
 * global. Mantém um rascunho interno e só aplica em "Aplicar"; "Limpar" zera.
 *
 * Trocar o departamento limpa o tipo de película selecionado (pode não existir
 * no novo departamento).
 */

export interface InventoryFilters {
    department?: FilmDepartment;
    film_type_id?: number;
    status?: FilmRollStatus;
    use_galpon_store?: boolean;
}

export interface InventoryFilterSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface InventoryFilterSheetProps {
    value: InventoryFilters;
    onApply: (filters: InventoryFilters) => void;
    /** Exibe o toggle "Galpão" (perfis sem galpão não veem). */
    showGalponToggle?: boolean;
}

interface Draft {
    department: FilmDepartment | undefined;
    film_type_id: number | undefined;
    status: FilmRollStatus | undefined;
    use_galpon_store: boolean;
}

function toDraft(value: InventoryFilters): Draft {
    return {
        department: value.department,
        film_type_id: value.film_type_id,
        status: value.status,
        use_galpon_store: value.use_galpon_store ?? false,
    };
}

export const InventoryFilterSheet = forwardRef<InventoryFilterSheetRef, InventoryFilterSheetProps>(
    function InventoryFilterSheet({ value, onApply, showGalponToggle = false }, ref) {
        const modalRef = useRef<BottomSheetModal>(null);
        const insets = useSafeAreaInsets();
        const { isDark, colors } = useTheme();
        const [draft, setDraft] = useState<Draft>(() => toDraft(value));

        // Tipos de película do departamento escolhido (ou todos, se nenhum).
        const { data: filmTypes } = useFilmTypes(draft.department);
        const filmTypeOptions = useMemo(
            () => (filmTypes ?? []).map((ft) => ({ value: ft.id, label: ft.name })),
            [filmTypes]
        );

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
                film_type_id: draft.film_type_id,
                status: draft.status,
                use_galpon_store: draft.use_galpon_store || undefined,
            });
            modalRef.current?.dismiss();
        };

        const clear = () => {
            setDraft({
                department: undefined,
                film_type_id: undefined,
                status: undefined,
                use_galpon_store: false,
            });
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
                        {/* Departamento (único) — trocar limpa o tipo de película */}
                        <FilterLabel>Departamento</FilterLabel>
                        <View className="mb-5 flex-row flex-wrap gap-2">
                            <ChipToggle
                                label="Todos"
                                active={draft.department === undefined}
                                onPress={() =>
                                    setDraft((d) => ({
                                        ...d,
                                        department: undefined,
                                        film_type_id: undefined,
                                    }))
                                }
                            />
                            {FILM_DEPARTMENT_OPTIONS.map((dep) => (
                                <ChipToggle
                                    key={dep.value}
                                    label={dep.label}
                                    active={draft.department === dep.value}
                                    onPress={() =>
                                        setDraft((d) => ({
                                            ...d,
                                            department: d.department === dep.value ? undefined : dep.value,
                                            film_type_id: undefined,
                                        }))
                                    }
                                />
                            ))}
                        </View>

                        {/* Tipo de película (único) */}
                        <FilterLabel>Tipo de película</FilterLabel>
                        {filmTypeOptions.length > 0 ? (
                            <View className="mb-5 flex-row flex-wrap gap-2">
                                <ChipToggle
                                    label="Todos"
                                    active={draft.film_type_id === undefined}
                                    onPress={() => setDraft((d) => ({ ...d, film_type_id: undefined }))}
                                />
                                {filmTypeOptions.map((ft) => (
                                    <ChipToggle
                                        key={ft.value}
                                        label={ft.label}
                                        active={draft.film_type_id === ft.value}
                                        onPress={() =>
                                            setDraft((d) => ({
                                                ...d,
                                                film_type_id:
                                                    d.film_type_id === ft.value ? undefined : ft.value,
                                            }))
                                        }
                                    />
                                ))}
                            </View>
                        ) : (
                            <Text className="mb-5 font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                                Nenhum tipo de película disponível.
                            </Text>
                        )}

                        {/* Status (único) */}
                        <FilterLabel>Status</FilterLabel>
                        <View className="mb-5 flex-row flex-wrap gap-2">
                            <ChipToggle
                                label="Todos"
                                active={draft.status === undefined}
                                onPress={() => setDraft((d) => ({ ...d, status: undefined }))}
                            />
                            {FILM_ROLL_STATUS_OPTIONS.map((st) => (
                                <ChipToggle
                                    key={st.value}
                                    label={st.label}
                                    active={draft.status === st.value}
                                    onPress={() =>
                                        setDraft((d) => ({
                                            ...d,
                                            status: d.status === st.value ? undefined : st.value,
                                        }))
                                    }
                                />
                            ))}
                        </View>

                        {/* Galpão (flag) */}
                        {showGalponToggle ? (
                            <>
                                <FilterLabel>Galpão</FilterLabel>
                                <View className="mb-2 flex-row flex-wrap gap-2">
                                    <ChipToggle
                                        label="Somente galpão"
                                        active={draft.use_galpon_store}
                                        onPress={() =>
                                            setDraft((d) => ({
                                                ...d,
                                                use_galpon_store: !d.use_galpon_store,
                                            }))
                                        }
                                    />
                                </View>
                            </>
                        ) : null}
                    </ScrollView>

                    <View className="px-5 pt-2">
                        <Button title="Aplicar filtros" icon="checkmark" onPress={apply} />
                    </View>
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
