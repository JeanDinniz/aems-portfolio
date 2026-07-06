import { useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Select, type SelectRef } from '@/components/ui/Select';
import { ErrorState } from '@/components/ui/ErrorState';
import { useServices } from '@/hooks/useServices';
import { useStoreStore } from '@/stores/store.store';
import { useTheme } from '@/theme';
import type { ServiceItem } from '@/services/api/services.service';

/**
 * Item de serviço selecionado no payload de uma O.S. — vira `items[]`.
 * Sem tonalidade/bobina aqui (isso é definido na FINALIZAÇÃO da O.S.).
 */
export interface ServiceItemSelection {
    service_id: number;
    quantity: number;
}

export interface ServiceItemPickerProps {
    /** Departamento para filtrar o catálogo (ex.: 'film', 'ppf', 'estetica'). */
    department?: string;
    /** Serviços já selecionados. */
    value: ServiceItemSelection[];
    onChange: (value: ServiceItemSelection[]) => void;
    /**
     * Loja da O.S. (vinda do form via `location_id`). Quando ausente, cai para a
     * loja selecionada globalmente — não usado para filtrar o catálogo de
     * serviços (que é global), mas exposto por paridade com os demais pickers.
     */
    storeId?: number;
    /** Marca para filtrar serviços (opcional). */
    brandId?: number;
    /**
     * Lançamento é cortesia? Quando `false`, oculta serviços `is_courtesy_only`.
     * Quando `true`, mostra todos (espelha o web). Default: false.
     */
    isCourtesy?: boolean;
    /** Rótulo acima do campo. */
    label?: string;
    /** Texto de erro de validação (ex.: "Selecione ao menos 1 serviço"). */
    error?: string;
}

/**
 * Multi-select de serviços por departamento (Criar O.S.).
 *
 * Construído sobre o `Select` (modo `multiple`) do design system. Mostra os
 * serviços escolhidos como uma lista com botão de remover. Cada item vira
 * `{ service_id, quantity: 1 }` no payload `items[]` da O.S.
 *
 * Estados: carregando (spinner), erro (ErrorState com retry), vazio
 * (mensagem dentro do sheet via Select).
 */
export function ServiceItemPicker({
    department,
    value,
    onChange,
    storeId,
    brandId,
    isCourtesy = false,
    label = 'Serviços',
    error,
}: ServiceItemPickerProps) {
    const selectRef = useRef<SelectRef>(null);
    const { colors } = useTheme();
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    // Exposto por paridade; o catálogo de serviços é global (não filtra por loja).
    void (storeId ?? selectedStoreId);

    const { data: allServices = [], isLoading, isError, refetch } = useServices(department, brandId);

    // A8 — serviços exclusivos de cortesia só aparecem em lançamento de cortesia.
    const services = useMemo(
        () => (isCourtesy ? allServices : allServices.filter((s) => !s.is_courtesy_only)),
        [allServices, isCourtesy]
    );

    const options = useMemo(
        () =>
            services.map((s) => ({
                value: s.id,
                label: s.code ? `${s.code} — ${s.name}` : s.name,
            })),
        [services]
    );

    const selectedIds = useMemo(() => value.map((v) => v.service_id), [value]);

    const serviceById = useMemo(() => {
        const map = new Map<number, ServiceItem>();
        services.forEach((s) => map.set(s.id, s));
        return map;
    }, [services]);

    const handleSelectionChange = (ids: number[]) => {
        // Preserva quantidades existentes; novos itens entram com quantity 1.
        const next: ServiceItemSelection[] = ids.map((id) => {
            const existing = value.find((v) => v.service_id === id);
            return existing ?? { service_id: id, quantity: 1 };
        });
        onChange(next);
    };

    const removeItem = (serviceId: number) => {
        onChange(value.filter((v) => v.service_id !== serviceId));
    };

    if (isError) {
        return (
            <View>
                <PickerLabel>{label}</PickerLabel>
                <ErrorState
                    title="Erro ao carregar serviços"
                    description="Não foi possível carregar o catálogo. Tente novamente."
                    onRetry={() => refetch()}
                    className="py-6"
                />
            </View>
        );
    }

    return (
        <View>
            <PickerLabel>{label}</PickerLabel>

            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !department }}
                accessibilityLabel={`Selecionar serviços. ${value.length} selecionado(s).`}
                disabled={!department}
                onPress={() => selectRef.current?.present()}
                className={[
                    'min-h-[48px] flex-row items-center justify-between rounded-xl border px-4 py-3 active:opacity-80',
                    error
                        ? 'border-error'
                        : 'border-neutral-200 dark:border-dark-border-soft',
                    'bg-white dark:bg-dark-surface',
                    !department ? 'opacity-60' : '',
                ].join(' ')}
            >
                <Text
                    className={[
                        'flex-1 font-sans text-base',
                        value.length > 0
                            ? 'text-neutral-900 dark:text-dark-text'
                            : 'text-neutral-400 dark:text-dark-text-muted',
                    ].join(' ')}
                >
                    {!department
                        ? 'Selecione o departamento primeiro'
                        : isLoading
                          ? 'Carregando serviços...'
                          : value.length > 0
                            ? `${value.length} serviço(s) selecionado(s)`
                            : 'Toque para selecionar serviços'}
                </Text>
                {isLoading && department ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                ) : (
                    <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
                )}
            </Pressable>

            {error ? (
                <Text className="mt-1.5 font-sans text-xs text-error">{error}</Text>
            ) : null}

            {/* Lista de serviços escolhidos com remover. */}
            {value.length > 0 ? (
                <View className="mt-3 gap-2">
                    {value.map((item) => {
                        const service = serviceById.get(item.service_id);
                        const name = service
                            ? service.code
                                ? `${service.code} — ${service.name}`
                                : service.name
                            : `Serviço #${item.service_id}`;
                        return (
                            <View
                                key={item.service_id}
                                className="flex-row items-center gap-3 rounded-xl bg-neutral-50 px-3.5 py-3 dark:bg-dark-elevated"
                            >
                                <Ionicons name="cube-outline" size={18} color={colors.textMuted} />
                                <Text
                                    className="flex-1 font-sans text-sm text-neutral-800 dark:text-dark-text"
                                    numberOfLines={2}
                                >
                                    {name}
                                </Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`Remover ${name}`}
                                    hitSlop={8}
                                    onPress={() => removeItem(item.service_id)}
                                    className="h-7 w-7 items-center justify-center rounded-full active:bg-neutral-200 dark:active:bg-dark-surface"
                                >
                                    <Ionicons name="close" size={18} color={colors.textMuted} />
                                </Pressable>
                            </View>
                        );
                    })}
                </View>
            ) : null}

            <Select<number>
                ref={selectRef}
                title="Selecionar serviços"
                multiple
                options={options}
                value={selectedIds}
                onChange={handleSelectionChange}
            />
        </View>
    );
}

function PickerLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1.5 font-sans-medium text-sm text-neutral-700 dark:text-dark-text">
            {children}
        </Text>
    );
}
