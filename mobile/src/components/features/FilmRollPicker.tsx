import { useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { Select, type SelectRef, type SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { inventoryService, type FilmRoll } from '@/services/api/inventory.service';

/**
 * OS-09 — FilmRollPicker: dropdown de bobinas para vincular ao consumo na
 * finalização de O.S. Portado de
 * frontend/src/components/features/scheduling/FilmRollSelector.tsx.
 *
 * Busca bobinas `em_estoque` + `em_uso` da loja (ou galpão) filtrando por
 * serviço/tipo de película e tonalidade do item. Usa o `Select` (bottom sheet)
 * do design system. Bobina é obrigatória por item de película (film/ppf).
 */

export interface FilmRollPickerProps {
    storeId: number;
    department: string;
    serviceId: number;
    tonality: string | null;
    serviceName: string;
    filmTypeId?: number;
    value: number | undefined;
    onChange: (rollId: number | undefined) => void;
    isGalpon?: boolean;
    /**
     * Bobina obrigatória? Quando `true` e sem valor, o campo fica com borda de
     * erro. Para `ppf`/`security_film` a bobina é opcional (sem realce). Default: true.
     */
    required?: boolean;
}

export function FilmRollPicker({
    storeId,
    department,
    serviceId,
    tonality,
    serviceName,
    filmTypeId,
    value,
    onChange,
    isGalpon = false,
    required = true,
}: FilmRollPickerProps) {
    const sheetRef = useRef<SelectRef>(null);

    const { data, isLoading } = useQuery({
        queryKey: [
            'film-rolls-for-os',
            isGalpon ? 'galpon' : storeId,
            department,
            serviceId,
            filmTypeId,
            tonality,
            isGalpon,
        ],
        queryFn: async () => {
            const rollParams = isGalpon
                ? ({ use_galpon_store: true } as const)
                : { store_id: storeId };

            // filmTypeId já determina o departamento; serviceId resolve via FilmTypeService.
            const deptParam =
                filmTypeId || serviceId
                    ? {}
                    : { department: department as 'film' | 'ppf' | 'security_film' };
            const svcParam = filmTypeId ? {} : { service_id: serviceId };

            const [inStock, inUse] = await Promise.all([
                inventoryService.listRolls({
                    ...rollParams,
                    ...deptParam,
                    ...svcParam,
                    film_type_id: filmTypeId,
                    status: 'em_estoque',
                    limit: 100,
                }),
                inventoryService.listRolls({
                    ...rollParams,
                    ...deptParam,
                    ...svcParam,
                    film_type_id: filmTypeId,
                    status: 'em_uso',
                    limit: 100,
                }),
            ]);
            const all = [...inStock.items, ...inUse.items] as FilmRoll[];
            return tonality ? all.filter((r) => r.tonality === tonality) : all;
        },
        enabled: isGalpon ? true : !!storeId,
        staleTime: 1000 * 60,
    });

    const rolls = useMemo(() => data ?? [], [data]);

    const options = useMemo<SelectOption<number>[]>(
        () =>
            rolls.map((roll) => ({
                value: roll.id,
                label: `${roll.visual_id} — ${roll.remaining_meters.toFixed(1)}m${
                    roll.status === 'em_uso' ? ' (em uso)' : ''
                }`,
            })),
        [rolls]
    );

    const selectedRoll = rolls.find((r) => r.id === value);
    const selectedLabel = selectedRoll
        ? `${selectedRoll.visual_id} — ${selectedRoll.remaining_meters.toFixed(1)}m`
        : undefined;

    return (
        <View className="mb-3">
            <Text
                className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text"
                numberOfLines={1}
            >
                {serviceName}
                {tonality ? (
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {`  (${tonality})`}
                    </Text>
                ) : null}
            </Text>

            {isLoading ? (
                <Skeleton width="100%" height={48} />
            ) : (
                <>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={selectedLabel ?? 'Selecionar bobina'}
                        disabled={rolls.length === 0}
                        onPress={() => sheetRef.current?.present()}
                        className={[
                            'min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-80',
                            required && value === undefined
                                ? 'border-error'
                                : 'border-neutral-200 dark:border-dark-border-strong',
                            'bg-white dark:bg-dark-input',
                            rolls.length === 0 ? 'opacity-60' : '',
                        ].join(' ')}
                    >
                        <Text
                            className={[
                                'flex-1 font-sans text-base',
                                selectedLabel
                                    ? 'text-neutral-900 dark:text-dark-text'
                                    : 'text-neutral-400 dark:text-dark-text-muted',
                            ].join(' ')}
                            numberOfLines={1}
                        >
                            {selectedLabel ??
                                (rolls.length === 0
                                    ? 'Nenhuma bobina disponível'
                                    : 'Selecionar bobina...')}
                        </Text>
                        <Ionicons name="chevron-down" size={20} color="#98A2B3" />
                    </Pressable>

                    <Select<number>
                        ref={sheetRef}
                        title="Selecionar bobina"
                        options={options}
                        value={value ?? null}
                        onChange={(v) => onChange(v)}
                    />
                </>
            )}
        </View>
    );
}
