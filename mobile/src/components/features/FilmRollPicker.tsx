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
 * Busca só bobinas `em_uso` da loja (ou galpão) filtrando por serviço/tipo de
 * película e tonalidade do item (lacradas não são ofertadas na finalização —
 * abrir bobina é ação da tela de Estoque). Usa o `Select` (bottom sheet)
 * do design system. Bobina é obrigatória por item de película (film/ppf).
 *
 * RETALHO (sobra): quando o pai passa `onSelectScrap`, o seletor ganha a opção
 * "Retalho (sobra)" no topo da lista. Escolhê-la sinaliza que o serviço foi feito
 * com sobra de um corte anterior (já debitada da bobina na época): nada será
 * debitado de novo, o campo deixa de ser obrigatório e NÃO há bobina de origem —
 * `used_scrap=true` sem `film_roll_id`. O pai controla o estado via `isScrap`.
 */

/** Valor sentinela do Select para a opção "Retalho (sobra)" (ids reais são > 0). */
const SCRAP_OPTION = -1;

export interface FilmRollPickerProps {
    storeId: number;
    department: string;
    serviceId: number;
    tonality: string | null;
    serviceName: string;
    filmTypeId?: number;
    value: number | undefined;
    /** Emite o id e (quando disponível) a própria bobina, para o pai validar metragem. */
    onChange: (rollId: number | undefined, roll?: FilmRoll) => void;
    isGalpon?: boolean;
    /**
     * Bobina obrigatória? Quando `true` e sem valor, o campo fica com borda de
     * erro. Para `ppf`/`security_film` a bobina é opcional (sem realce). Default: true.
     * Em modo retalho (`isScrap`) o campo nunca fica em erro.
     */
    required?: boolean;
    /**
     * Slot marcado como "Retalho (sobra)": o campo exibe "Retalho (sobra)", nunca
     * fica em estado de erro e não há bobina de origem. Controlado pelo pai. Default: false.
     */
    isScrap?: boolean;
    /**
     * Quando fornecido, a opção "Retalho (sobra)" aparece no seletor. Chamado ao
     * escolhê-la — o pai marca o slot como retalho (used_scrap) e limpa a bobina.
     */
    onSelectScrap?: () => void;
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
    isScrap = false,
    onSelectScrap,
}: FilmRollPickerProps) {
    const sheetRef = useRef<SelectRef>(null);
    const allowScrap = !!onSelectScrap;

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
            const baseParams = {
                ...rollParams,
                ...deptParam,
                ...svcParam,
                film_type_id: filmTypeId,
                limit: 100,
            } as const;

            // Só bobinas em uso são ofertadas na finalização (lacradas não; esgotadas
            // também não — retalho não aponta bobina de origem).
            const result = await inventoryService.listRolls({
                ...baseParams,
                statuses: ['em_uso'],
            });
            const all = (result.items ?? []) as FilmRoll[];

            return tonality ? all.filter((r) => r.tonality === tonality) : all;
        },
        enabled: isGalpon ? true : !!storeId,
        staleTime: 1000 * 60,
    });

    const rolls = useMemo(() => data ?? [], [data]);

    const options = useMemo<SelectOption<number>[]>(() => {
        const rollOptions = rolls.map((roll) => ({
            value: roll.id,
            label: `${roll.visual_id} — ${roll.remaining_meters.toFixed(1)}m${
                roll.status === 'em_uso' ? ' (em uso)' : ''
            }`,
        }));
        // "Retalho (sobra)" no topo quando o pai habilita o modo retalho.
        return allowScrap
            ? [{ value: SCRAP_OPTION, label: 'Retalho (sobra)' }, ...rollOptions]
            : rollOptions;
    }, [rolls, allowScrap]);

    const selectedRoll = rolls.find((r) => r.id === value);
    const selectedLabel = isScrap
        ? 'Retalho (sobra)'
        : selectedRoll
          ? `${selectedRoll.visual_id} — ${selectedRoll.remaining_meters.toFixed(1)}m`
          : undefined;

    // Em retalho a bobina nunca é exigida (nada será debitado).
    const showError = required && !isScrap && value === undefined;
    const placeholder = rolls.length === 0 ? 'Nenhuma bobina disponível' : 'Selecionar bobina...';

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
                        disabled={options.length === 0}
                        onPress={() => sheetRef.current?.present()}
                        className={[
                            'min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-80',
                            showError
                                ? 'border-error'
                                : 'border-neutral-200 dark:border-dark-border-strong',
                            'bg-white dark:bg-dark-input',
                            options.length === 0 ? 'opacity-60' : '',
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
                            {selectedLabel ?? placeholder}
                        </Text>
                        <Ionicons name="chevron-down" size={20} color="#98A2B3" />
                    </Pressable>

                    <Select<number>
                        ref={sheetRef}
                        title="Selecionar bobina"
                        options={options}
                        value={isScrap ? SCRAP_OPTION : (value ?? null)}
                        onChange={(v) =>
                            v === SCRAP_OPTION
                                ? onSelectScrap?.()
                                : onChange(v, rolls.find((r) => r.id === v))
                        }
                    />

                    {isScrap ? (
                        <Text className="mt-1.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            A sobra já foi descontada no corte anterior — a bobina não será
                            debitada.
                        </Text>
                    ) : null}
                </>
            )}
        </View>
    );
}
