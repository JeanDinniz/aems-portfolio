import { useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Select, type SelectRef, type SelectOption } from '@/components/ui/Select';

/**
 * Multi-instalador por serviço — usado na finalização de O.S. de película
 * (film/security_film/ppf), abaixo do FilmRollPicker de cada item.
 *
 * Espelha o web `ServiceInstallerSelect`: para esses departamentos o multi-select
 * geral de funcionários é substituído por uma seleção de 1..N instaladores POR
 * SERVIÇO. Quando mais de um instalador faz o mesmo serviço, a produção é dividida
 * igualmente entre eles no módulo Desempenho (cálculo do backend). ≥1 obrigatório.
 *
 * A lista já vem filtrada pelo chamador (`position === 'Instalador de Película'`).
 *
 * UX mobile: um campo "gatilho" abre uma bottom sheet de seleção múltipla; os
 * selecionados aparecem como chips removíveis (toque no "x" remove). Sem valor,
 * o campo fica com borda de erro (obrigatório).
 */
export interface InstallerOption {
    id: number;
    name: string;
}

export interface ServiceInstallerPickerProps {
    serviceName: string;
    installers: InstallerOption[];
    /** Instaladores selecionados para este serviço (≥1 obrigatório). */
    value: number[];
    onChange: (employeeIds: number[]) => void;
    /** Realça a borda quando obrigatório e vazio. Default: true. */
    required?: boolean;
}

export function ServiceInstallerPicker({
    serviceName,
    installers,
    value,
    onChange,
    required = true,
}: ServiceInstallerPickerProps) {
    const sheetRef = useRef<SelectRef>(null);

    const options = useMemo<SelectOption<number>[]>(
        () => installers.map((e) => ({ value: e.id, label: e.name })),
        [installers]
    );

    const isEmpty = value.length === 0;

    // Resumo exibido no campo gatilho: 1 nome, ou "N instaladores selecionados".
    const summary = useMemo(() => {
        if (value.length === 0) {
            return installers.length === 0
                ? 'Nenhum instalador disponível'
                : 'Selecionar instalador...';
        }
        if (value.length === 1) {
            return installers.find((e) => e.id === value[0])?.name ?? '1 instalador';
        }
        return `${value.length} instaladores selecionados`;
    }, [value, installers]);

    const removeInstaller = (empId: number) => {
        onChange(value.filter((x) => x !== empId));
    };

    return (
        <View className="mb-3">
            <Text
                className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text"
                numberOfLines={1}
            >
                {serviceName}
                <Text className="text-error">{' *'}</Text>
                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {'  (instaladores)'}
                </Text>
            </Text>

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={summary}
                disabled={installers.length === 0}
                onPress={() => sheetRef.current?.present()}
                className={[
                    'min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-80',
                    required && isEmpty
                        ? 'border-error'
                        : 'border-neutral-200 dark:border-dark-border-strong',
                    'bg-white dark:bg-dark-input',
                    installers.length === 0 ? 'opacity-60' : '',
                ].join(' ')}
            >
                <Text
                    className={[
                        'flex-1 font-sans text-base',
                        !isEmpty
                            ? 'text-neutral-900 dark:text-dark-text'
                            : 'text-neutral-400 dark:text-dark-text-muted',
                    ].join(' ')}
                    numberOfLines={1}
                >
                    {summary}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#98A2B3" />
            </Pressable>

            {/* Selecionados como chips removíveis */}
            {!isEmpty ? (
                <View className="mt-2 flex-row flex-wrap gap-2">
                    {value.map((empId) => {
                        const emp = installers.find((e) => e.id === empId);
                        if (!emp) return null;
                        return (
                            <Pressable
                                key={empId}
                                accessibilityRole="button"
                                accessibilityLabel={`Remover ${emp.name}`}
                                onPress={() => removeInstaller(empId)}
                                className="min-h-[32px] flex-row items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 active:opacity-80"
                            >
                                <Text className="font-sans-semibold text-sm text-brand-black">
                                    {emp.name}
                                </Text>
                                <Ionicons name="close" size={14} color="#1A1A1A" />
                            </Pressable>
                        );
                    })}
                </View>
            ) : null}

            <Select<number>
                ref={sheetRef}
                multiple
                title="Selecionar instaladores"
                options={options}
                value={value}
                onChange={onChange}
            />
        </View>
    );
}
