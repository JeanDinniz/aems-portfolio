import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
    serviceOrdersService,
    type ReturnOriginSuggestion,
} from '@/services/api/service-orders.service';

/**
 * Seletor visual da "O.S. de origem" ao marcar Retorno — espelha o bloco do web
 * (QuickCreateModal §"O.S. de origem").
 *
 * Auto-encapsula TODO o estado do fluxo (sugestão, carregando, confirmado,
 * trocar, input manual) e a busca no backend. Sobe apenas o vínculo escolhido
 * via `onChange(id | null)`, que o formulário grava em `original_service_order_id`.
 *
 * Comportamento (idêntico ao web):
 *   - `isReturn=false` ou placa/chassi inválida → limpa tudo e emite `null`.
 *   - com placa válida → busca automática (debounce curto); mostra card
 *     selecionável com Confirmar/Trocar/Limpar.
 *   - "Trocar" abre input manual por placa/chassi (busca a O.S. de origem).
 *   - Confirmado → chip verde com botão de limpar.
 *
 * Reutilizado por Create e Edit. No Edit passa-se `excludeOsId` (não sugerir a
 * própria O.S.) e `initialSelectedId` (repõe o vínculo existente ao abrir).
 */

interface ReturnOriginPickerProps {
    /** Só renderiza/busca quando `true` (checkbox Retorno marcado). */
    isReturn: boolean;
    /** Placa/chassi já normalizada (A-Z0-9) do formulário; dispara a busca. */
    plateOrChassi: string;
    /** Valida placa/chassi (mesma regra da tela). */
    isValidPlateOrChassi: (value: string) => boolean;
    /** Vínculo atual selecionado (null = nenhum). Sobe ao formulário. */
    onChange: (id: number | null) => void;
    /** Bloqueia interação (edição travada). */
    disabled?: boolean;
    /** Edit: não sugerir a própria O.S. como origem. */
    excludeOsId?: number;
    /** Edit: id de origem já gravado — repõe o estado "confirmado" ao abrir. */
    initialSelectedId?: number | null;
    /** Loja onde o retorno será aberto — amplia a busca às lojas da mesma marca. */
    storeId?: number;
    /** Departamento do retorno — restringe a origem ao mesmo departamento. */
    department?: string;
}

export function ReturnOriginPicker({
    isReturn,
    plateOrChassi,
    isValidPlateOrChassi,
    onChange,
    disabled = false,
    excludeOsId,
    initialSelectedId,
    storeId,
    department,
}: ReturnOriginPickerProps) {
    const [suggestion, setSuggestion] = useState<ReturnOriginSuggestion | null>(null);
    const [loadingPlate, setLoadingPlate] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [changing, setChanging] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [searchedEmpty, setSearchedEmpty] = useState(false);

    // Espelho estável do onChange para não re-disparar o efeito de busca.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Placa/chassi para a qual a busca/confirmação atual é válida. Serve para
    // (a) não re-buscar quando a placa não mudou (preserva a confirmação e a
    // restauração do modo Edit) e (b) descartar o vínculo quando a placa muda.
    const lastSearchedPlateRef = useRef<string | null>(null);

    // Repõe o vínculo pré-existente (Edit) uma única vez, buscando os dados da
    // O.S. de origem pelo `exclude`-less lookup da placa e casando pelo id.
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        if (!isReturn || !initialSelectedId) return;
        const p = plateOrChassi.toUpperCase().trim();
        if (!p || !isValidPlateOrChassi(p)) return;
        restoredRef.current = true;
        // Marca a placa+loja como já buscada: o efeito de auto-busca abaixo roda no
        // mesmo mount e, sem isto, re-buscaria e apagaria o vínculo restaurado.
        lastSearchedPlateRef.current = `${p}|${storeId ?? ''}|${department ?? ''}`;
        setLoadingPlate(p);
        serviceOrdersService
            .suggestReturnOrigin(p, excludeOsId, storeId, department || undefined)
            .then((sug) => {
                setLoadingPlate(null);
                if (sug && sug.id === initialSelectedId) {
                    setSuggestion(sug);
                    setConfirmed(true);
                } else if (sug) {
                    // A sugestão automática difere do vínculo salvo — apresenta a
                    // sugestão para o usuário reconfirmar/trocar (não some o campo).
                    setSuggestion(sug);
                }
            })
            .catch(() => setLoadingPlate(null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReturn, initialSelectedId]);

    // Busca automática quando is_return=true e placa válida (espelha o web).
    useEffect(() => {
        const p = plateOrChassi.toUpperCase().trim();
        if (!isReturn || !p || !isValidPlateOrChassi(p)) {
            lastSearchedPlateRef.current = null;
            setSuggestion(null);
            setConfirmed(false);
            setChanging(false);
            setInputValue('');
            setSearchedEmpty(false);
            onChangeRef.current(null);
            return;
        }
        // Placa+loja inalteradas desde a última busca/confirmação → não re-buscar
        // (não sobrescreve a confirmação nem a restauração do modo Edit).
        const searchKey = `${p}|${storeId ?? ''}|${department ?? ''}`;
        if (lastSearchedPlateRef.current === searchKey) return;
        // Placa (ou loja/marca) mudou: o vínculo anterior pode ser de outro veículo
        // ou outra marca — descarta antes de buscar a O.S. de origem.
        lastSearchedPlateRef.current = searchKey;
        setConfirmed(false);
        setChanging(false);
        setInputValue('');
        setSearchedEmpty(false);
        onChangeRef.current(null);
        let active = true;
        setLoadingPlate(p);
        const t = setTimeout(() => {
            serviceOrdersService
                .suggestReturnOrigin(p, excludeOsId, storeId, department || undefined)
                .then((sug) => {
                    if (!active) return;
                    setSuggestion(sug);
                    setLoadingPlate(null);
                })
                .catch(() => {
                    if (!active) return;
                    setSuggestion(null);
                    setLoadingPlate(null);
                });
        }, 400);
        return () => {
            active = false;
            clearTimeout(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReturn, plateOrChassi, storeId, department]);

    const handleManualSearch = useCallback(async () => {
        const searchPlate = inputValue.trim() || plateOrChassi.toUpperCase().trim();
        if (!searchPlate) return;
        setSearchedEmpty(false);
        setLoadingPlate(searchPlate);
        try {
            const sug = await serviceOrdersService.suggestReturnOrigin(searchPlate, excludeOsId, storeId, department || undefined);
            setLoadingPlate(null);
            if (sug) {
                setSuggestion(sug);
                onChangeRef.current(sug.id);
                setConfirmed(true);
                setChanging(false);
            } else {
                setSuggestion(null);
                setSearchedEmpty(true);
            }
        } catch {
            setLoadingPlate(null);
            setSuggestion(null);
            setSearchedEmpty(true);
        }
    }, [inputValue, plateOrChassi, excludeOsId, storeId, department]);

    if (!isReturn) return null;

    const validPlate = isValidPlateOrChassi(plateOrChassi.toUpperCase().trim());

    return (
        <View className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 dark:border-dark-border-strong dark:bg-dark-elevated">
            <View className="mb-2 flex-row items-center gap-1.5">
                <Ionicons name="repeat-outline" size={14} color="#98A2B3" />
                <Text className="font-sans-semibold text-xs uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                    O.S. de origem
                </Text>
            </View>

            {/* Carregando */}
            {loadingPlate && !confirmed ? (
                <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color="#98A2B3" />
                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        Buscando O.S. original...
                    </Text>
                </View>
            ) : null}

            {/* Sugestão disponível e não confirmada */}
            {!loadingPlate && suggestion && !confirmed && !changing ? (
                <View className="gap-2">
                    <View className="rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-dark-border-strong dark:bg-dark-surface">
                        <Text className="font-sans-semibold text-sm text-neutral-900 dark:text-dark-text">
                            {suggestion.order_number ?? `#${suggestion.id}`}
                            {suggestion.external_os_number ? (
                                <Text className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                                    {`  (${suggestion.external_os_number})`}
                                </Text>
                            ) : null}
                        </Text>
                        {suggestion.service_date ? (
                            <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                {formatDateBR(suggestion.service_date)}
                            </Text>
                        ) : null}
                        {suggestion.services.length > 0 ? (
                            <Text
                                numberOfLines={1}
                                className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted"
                            >
                                {suggestion.services.join(', ')}
                            </Text>
                        ) : null}
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                        <OriginButton
                            variant="primary"
                            icon="checkmark"
                            label="Confirmar"
                            disabled={disabled}
                            onPress={() => {
                                onChange(suggestion.id);
                                setConfirmed(true);
                            }}
                        />
                        <OriginButton
                            variant="outline"
                            label="Trocar"
                            disabled={disabled}
                            onPress={() => {
                                setChanging(true);
                                setInputValue('');
                                setSearchedEmpty(false);
                            }}
                        />
                        <OriginButton
                            variant="outline"
                            label="Limpar"
                            disabled={disabled}
                            onPress={() => {
                                setSuggestion(null);
                                onChange(null);
                            }}
                        />
                    </View>
                </View>
            ) : null}

            {/* Confirmado */}
            {confirmed && suggestion ? (
                <View className="flex-row items-center justify-between gap-2">
                    <View className="flex-1 flex-row items-center gap-2">
                        <Ionicons name="checkmark-circle" size={18} color="#12B76A" />
                        <Text
                            numberOfLines={1}
                            className="flex-1 font-sans-semibold text-sm text-neutral-900 dark:text-dark-text"
                        >
                            {suggestion.order_number ?? `#${suggestion.id}`}
                            {suggestion.external_os_number ? (
                                <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                    {`  (${suggestion.external_os_number})`}
                                </Text>
                            ) : null}
                        </Text>
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Limpar O.S. de origem"
                        hitSlop={8}
                        disabled={disabled}
                        onPress={() => {
                            setConfirmed(false);
                            setSuggestion(null);
                            onChange(null);
                        }}
                        className={disabled ? 'opacity-40' : ''}
                    >
                        <Ionicons name="close" size={18} color="#98A2B3" />
                    </Pressable>
                </View>
            ) : null}

            {/* Trocar — input manual por placa/chassi */}
            {changing ? (
                <View className="gap-1.5">
                    <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        Informe a placa/chassi da O.S. de origem:
                    </Text>
                    <View className="flex-row items-center gap-2">
                        <TextInput
                            value={inputValue}
                            onChangeText={(t) =>
                                setInputValue(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                            }
                            placeholder="Placa/chassi de origem"
                            placeholderTextColor="#98A2B3"
                            autoCapitalize="characters"
                            autoCorrect={false}
                            maxLength={17}
                            editable={!disabled}
                            className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-sans text-sm tracking-widest text-neutral-900 dark:border-dark-border-strong dark:bg-dark-input dark:text-dark-text"
                        />
                        <OriginButton
                            variant="primary"
                            icon="search"
                            label="Buscar"
                            disabled={disabled}
                            onPress={handleManualSearch}
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancelar troca"
                            hitSlop={8}
                            disabled={disabled}
                            onPress={() => {
                                setChanging(false);
                                setInputValue('');
                                setSearchedEmpty(false);
                            }}
                        >
                            <Ionicons name="close" size={18} color="#98A2B3" />
                        </Pressable>
                    </View>
                    {inputValue.trim() && !loadingPlate && searchedEmpty ? (
                        <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                            Nenhuma O.S. encontrada para essa placa/chassi.
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {/* Sem sugestão e não carregando */}
            {!loadingPlate && !suggestion && !confirmed && !changing ? (
                <Text className="font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                    {validPlate
                        ? 'Nenhuma O.S. anterior encontrada para esta placa.'
                        : 'Informe a placa para buscar a O.S. original.'}
                </Text>
            ) : null}
        </View>
    );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

/** "AAAA-MM-DD" → "DD/MM/AAAA" para exibição. */
function formatDateBR(iso: string): string {
    const [y, m, d] = iso.split('T')[0].split('-');
    return y && m && d ? `${d}/${m}/${y}` : iso;
}

interface OriginButtonProps {
    variant: 'primary' | 'outline';
    label: string;
    onPress: () => void;
    icon?: keyof typeof Ionicons.glyphMap;
    disabled?: boolean;
}

function OriginButton({ variant, label, onPress, icon, disabled }: OriginButtonProps) {
    const isPrimary = variant === 'primary';
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            className={[
                'min-h-[36px] flex-row items-center justify-center gap-1 rounded-lg px-3 py-1.5 active:opacity-80',
                isPrimary
                    ? 'bg-brand'
                    : 'border border-neutral-200 bg-white dark:border-dark-border-strong dark:bg-dark-surface',
                disabled ? 'opacity-40' : '',
            ].join(' ')}
        >
            {icon ? (
                <Ionicons name={icon} size={13} color={isPrimary ? '#111111' : '#667085'} />
            ) : null}
            <Text
                className={[
                    'font-sans-semibold text-xs',
                    isPrimary ? 'text-brand-black' : 'text-neutral-600 dark:text-dark-text',
                ].join(' ')}
            >
                {label}
            </Text>
        </Pressable>
    );
}
