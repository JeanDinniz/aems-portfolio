import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Select, type SelectRef } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme';
import { useCreateWithdrawal, useFilmRolls, useFilmTypes } from '@/hooks/useInventory';
import { employeesService } from '@/services/api/employees.service';
import { FILM_INSTALLER_POSITION } from '@/constants/employees';
import type { FilmRoll } from '@/services/api/inventory.service';

/**
 * Sheet de Saída Avulsa de Película (paridade com o web `WithdrawalModal`).
 *
 * Dá baixa de metros de uma bobina para um funcionário (ex.: pedaço pedido pelo
 * instalador, descontado no fim do mês). Cascata client-side sobre as bobinas já
 * carregadas: Loja → Tipo → Tonalidade (só se department !== 'ppf') → Bobina →
 * Metros → Instalador → Motivo.
 *
 * Regras (do web):
 *  - Só bobinas NÃO esgotadas entram na cascata.
 *  - Metros: aceita vírgula decimal, deve ser > 0 e ≤ remaining_meters da bobina.
 *  - Instaladores: ativos de QUALQUER loja (quem retira pode ser de outra loja/
 *    galpão), com os da loja da bobina primeiro.
 *  - Sucesso → fecha o sheet e invalida as queries (via useCreateWithdrawal).
 */

export interface CreateWithdrawalSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface CreateWithdrawalSheetProps {
    /** Loja pré-selecionada (loja global). `null` → nenhuma. */
    defaultStoreId?: number | null;
}

function fmtMeters(value: number): string {
    return `${value.toFixed(1)}m`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' sem criar Date (evita deslocamento de timezone). */
function formatReceiptDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

export const CreateWithdrawalSheet = forwardRef<
    CreateWithdrawalSheetRef,
    CreateWithdrawalSheetProps
>(function CreateWithdrawalSheet({ defaultStoreId }, ref) {
    const sheetRef = useRef<SheetRef>(null);
    const { colors } = useTheme();
    const createWithdrawal = useCreateWithdrawal();

    // Sheets aninhados (Select) — precisam de refs próprias.
    const storeSheetRef = useRef<SelectRef>(null);
    const filmTypeSheetRef = useRef<SelectRef>(null);
    const tonalitySheetRef = useRef<SelectRef>(null);
    const rollSheetRef = useRef<SelectRef>(null);
    const employeeSheetRef = useRef<SelectRef>(null);

    const [open, setOpen] = useState(false);
    const [storeId, setStoreId] = useState<number | 0>(defaultStoreId ?? 0);
    const [filmTypeId, setFilmTypeId] = useState<number | 0>(0);
    const [tonality, setTonality] = useState<string>('');
    const [rollId, setRollId] = useState<number | 0>(0);
    const [meters, setMeters] = useState<string>('');
    const [employeeId, setEmployeeId] = useState<number | 0>(0);
    const [reason, setReason] = useState<string>('');

    // Carrega TODAS as bobinas acessíveis e os tipos (a cascata é client-side,
    // igual ao web que recebe rolls/filmTypes da página).
    const { data: rolls = [] } = useFilmRolls();
    const { data: filmTypes = [] } = useFilmTypes();

    const reset = useCallback(() => {
        setStoreId(defaultStoreId ?? 0);
        setFilmTypeId(0);
        setTonality('');
        setRollId(0);
        setMeters('');
        setEmployeeId(0);
        setReason('');
    }, [defaultStoreId]);

    useImperativeHandle(ref, () => ({
        present: () => {
            reset();
            setOpen(true);
            sheetRef.current?.present();
        },
        dismiss: () => sheetRef.current?.dismiss(),
    }));

    const availableRolls = useMemo(
        () => rolls.filter((r) => r.status !== 'esgotada'),
        [rolls]
    );

    const stores = useMemo(() => {
        const seen = new Map<number, string>();
        for (const r of availableRolls) {
            if (!seen.has(r.store_id)) seen.set(r.store_id, r.store_name ?? `Loja ${r.store_id}`);
        }
        return [...seen.entries()]
            .map(([id, name]) => ({ value: id, label: name }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [availableRolls]);

    const storeRolls = useMemo(
        () => availableRolls.filter((r) => r.store_id === storeId),
        [availableRolls, storeId]
    );

    const storeFilmTypes = useMemo(() => {
        const ids = new Set(storeRolls.map((r) => r.film_type_id));
        return filmTypes.filter((ft) => ids.has(ft.id)).map((ft) => ({ value: ft.id, label: ft.name }));
    }, [storeRolls, filmTypes]);

    const selectedFilmType = filmTypes.find((ft) => ft.id === filmTypeId);
    const isPPF = selectedFilmType?.department === 'ppf';

    const typeRolls = useMemo(
        () => storeRolls.filter((r) => r.film_type_id === filmTypeId),
        [storeRolls, filmTypeId]
    );

    const tonalityOptions = useMemo(() => {
        const seen = new Set<string>();
        for (const r of typeRolls) {
            if (r.tonality) seen.add(r.tonality);
        }
        return [...seen].sort().map((t) => ({ value: t, label: t }));
    }, [typeRolls]);

    const candidateRolls = useMemo(
        () => (isPPF ? typeRolls : typeRolls.filter((r) => (r.tonality ?? '') === tonality)),
        [typeRolls, tonality, isPPF]
    );

    const rollOptions = useMemo(
        () =>
            candidateRolls.map((r) => ({
                value: r.id,
                label: `${formatReceiptDate(r.receipt_date)} · restam ${fmtMeters(r.remaining_meters)} de ${fmtMeters(r.total_meters)}`,
            })),
        [candidateRolls]
    );

    const selectedRoll: FilmRoll | null = candidateRolls.find((r) => r.id === rollId) ?? null;

    // Instaladores ativos de qualquer loja (a loja da cascata é a da BOBINA, não
    // a do instalador). Os da loja da bobina primeiro (paridade com o web).
    const { data: installers = [], isLoading: loadingEmployees } = useQuery({
        queryKey: ['employees-installers-all'],
        queryFn: async () => {
            const res = await employeesService.list(
                { is_active: true, position: FILM_INSTALLER_POSITION },
                1,
                500
            );
            return res.employees;
        },
        enabled: open,
        staleTime: 1000 * 60 * 5,
    });

    const employeeOptions = useMemo(() => {
        const own = installers.filter((e) => e.store_id === storeId);
        const others = installers.filter((e) => e.store_id !== storeId);
        return [...own, ...others].map((e) => ({ value: e.id, label: e.name }));
    }, [installers, storeId]);

    const metersValue = Number(meters.replace(',', '.'));
    const metersInvalid = meters !== '' && (!Number.isFinite(metersValue) || metersValue <= 0);
    const metersExceed =
        selectedRoll !== null &&
        Number.isFinite(metersValue) &&
        metersValue > selectedRoll.remaining_meters;
    const canSubmit =
        rollId !== 0 && employeeId !== 0 && meters !== '' && !metersInvalid && !metersExceed;

    const selectedStoreName = stores.find((s) => s.value === storeId)?.label;
    const selectedFilmTypeName = selectedFilmType?.name;
    const selectedRollLabel = rollOptions.find((o) => o.value === rollId)?.label;
    const selectedEmployeeName = employeeOptions.find((o) => o.value === employeeId)?.label;

    const isBusy = createWithdrawal.isPending;

    const submit = useCallback(async () => {
        if (!canSubmit || isBusy) return;
        try {
            await createWithdrawal.mutateAsync({
                film_roll_id: rollId as number,
                employee_id: employeeId as number,
                meters: metersValue,
                reason: reason.trim() || undefined,
            });
            sheetRef.current?.dismiss();
        } catch {
            // Toast de erro já é exibido pelo hook (onError).
        }
    }, [canSubmit, isBusy, createWithdrawal, rollId, employeeId, metersValue, reason]);

    return (
        <Sheet
            ref={sheetRef}
            title="Registrar saída de película"
            snapPoints={['85%']}
            onDismiss={() => setOpen(false)}
        >
            <BottomSheetScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
            >
                <View className="gap-3 pb-1">
                    {/* Loja */}
                    <View>
                        <FieldLabel>Loja</FieldLabel>
                        <PickerField
                            placeholder={
                                stores.length === 0 ? 'Nenhuma bobina disponível' : 'Selecione a loja'
                            }
                            value={selectedStoreName}
                            disabled={isBusy || stores.length === 0}
                            onPress={() => storeSheetRef.current?.present()}
                        />
                    </View>

                    {/* Tipo de película */}
                    <View>
                        <FieldLabel>Tipo de película</FieldLabel>
                        <PickerField
                            placeholder={
                                storeId === 0 ? 'Selecione a loja primeiro' : 'Selecione o tipo'
                            }
                            value={selectedFilmTypeName}
                            disabled={isBusy || storeId === 0 || storeFilmTypes.length === 0}
                            onPress={() => filmTypeSheetRef.current?.present()}
                        />
                    </View>

                    {/* Tonalidade (só se não-PPF) */}
                    {!isPPF ? (
                        <View>
                            <FieldLabel>Tonalidade</FieldLabel>
                            <PickerField
                                placeholder={
                                    filmTypeId === 0
                                        ? 'Selecione o tipo primeiro'
                                        : 'Selecione a tonalidade'
                                }
                                value={tonality || undefined}
                                disabled={isBusy || filmTypeId === 0 || tonalityOptions.length === 0}
                                onPress={() => tonalitySheetRef.current?.present()}
                            />
                        </View>
                    ) : null}

                    {/* Bobina */}
                    <View>
                        <FieldLabel>Bobina</FieldLabel>
                        <PickerField
                            placeholder={
                                candidateRolls.length === 0
                                    ? 'Nenhuma bobina disponível'
                                    : 'Selecione a bobina'
                            }
                            value={selectedRollLabel}
                            disabled={
                                isBusy ||
                                filmTypeId === 0 ||
                                (!isPPF && tonality === '') ||
                                candidateRolls.length === 0
                            }
                            onPress={() => rollSheetRef.current?.present()}
                        />
                    </View>

                    {/* Metros */}
                    <View>
                        <FieldLabel>Metros</FieldLabel>
                        <BottomSheetTextInput
                            placeholder="Ex: 1,60"
                            placeholderTextColor={colors.placeholder}
                            keyboardType="decimal-pad"
                            value={meters}
                            onChangeText={setMeters}
                            editable={!isBusy}
                            className={inputClasses(isBusy, metersInvalid || metersExceed)}
                        />
                        {metersExceed && selectedRoll ? (
                            <Text className="mt-1 font-sans text-xs text-error">
                                A bobina possui apenas {fmtMeters(selectedRoll.remaining_meters)}{' '}
                                restantes.
                            </Text>
                        ) : metersInvalid ? (
                            <Text className="mt-1 font-sans text-xs text-error">
                                Informe um valor maior que zero.
                            </Text>
                        ) : null}
                    </View>

                    {/* Quem pediu (instalador) */}
                    <View>
                        <FieldLabel>Quem pediu</FieldLabel>
                        <PickerField
                            placeholder={
                                loadingEmployees
                                    ? 'Carregando...'
                                    : employeeOptions.length === 0
                                      ? 'Nenhum instalador cadastrado'
                                      : 'Selecione o instalador'
                            }
                            value={selectedEmployeeName}
                            disabled={isBusy || employeeOptions.length === 0}
                            onPress={() => employeeSheetRef.current?.present()}
                        />
                    </View>

                    {/* Motivo (opcional) */}
                    <View>
                        <FieldLabel>
                            Motivo <Text className="font-sans text-neutral-400">(opcional)</Text>
                        </FieldLabel>
                        <BottomSheetTextInput
                            placeholder="Ex: pedaço para retrabalho"
                            placeholderTextColor={colors.placeholder}
                            value={reason}
                            onChangeText={setReason}
                            editable={!isBusy}
                            maxLength={500}
                            multiline
                            className={[inputClasses(isBusy, false), 'min-h-[64px]'].join(' ')}
                            style={{ textAlignVertical: 'top' }}
                        />
                    </View>

                    <Button
                        title="Registrar saída"
                        icon="checkmark"
                        loading={isBusy}
                        disabled={!canSubmit || isBusy}
                        onPress={submit}
                    />
                    <Button
                        title="Cancelar"
                        variant="ghost"
                        disabled={isBusy}
                        onPress={() => sheetRef.current?.dismiss()}
                    />
                </View>
            </BottomSheetScrollView>

            {/* Sheets aninhados de seleção */}
            <Select<number>
                ref={storeSheetRef}
                title="Selecionar loja"
                options={stores}
                value={storeId || null}
                onChange={(v) => {
                    setStoreId(v);
                    setFilmTypeId(0);
                    setTonality('');
                    setRollId(0);
                    setEmployeeId(0);
                }}
            />
            <Select<number>
                ref={filmTypeSheetRef}
                title="Selecionar tipo"
                options={storeFilmTypes}
                value={filmTypeId || null}
                onChange={(v) => {
                    setFilmTypeId(v);
                    setTonality('');
                    setRollId(0);
                }}
            />
            <Select<string>
                ref={tonalitySheetRef}
                title="Selecionar tonalidade"
                options={tonalityOptions}
                value={tonality || null}
                onChange={(v) => {
                    setTonality(v);
                    setRollId(0);
                }}
            />
            <Select<number>
                ref={rollSheetRef}
                title="Selecionar bobina"
                options={rollOptions}
                value={rollId || null}
                onChange={(v) => setRollId(v)}
            />
            <Select<number>
                ref={employeeSheetRef}
                title="Selecionar instalador"
                options={employeeOptions}
                value={employeeId || null}
                onChange={(v) => setEmployeeId(v)}
            />
        </Sheet>
    );
});

// ─── Subcomponentes locais ────────────────────────────────────────────────────

function inputClasses(busy: boolean, error: boolean): string {
    return [
        'rounded-lg border px-4 py-3 font-sans text-base',
        'text-neutral-900 dark:text-dark-text',
        'bg-white dark:bg-dark-input',
        error ? 'border-error' : 'border-neutral-200 dark:border-dark-border-strong',
        busy ? 'opacity-60' : '',
    ].join(' ');
}

function FieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
            {children}
        </Text>
    );
}

interface PickerFieldProps {
    placeholder: string;
    value?: string;
    onPress: () => void;
    disabled?: boolean;
}

function PickerField({ placeholder, value, onPress, disabled }: PickerFieldProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={value ?? placeholder}
            accessibilityState={{ disabled: !!disabled }}
            disabled={disabled}
            onPress={onPress}
            className={[
                'min-h-[48px] flex-row items-center justify-between rounded-lg border px-4 py-3 active:opacity-80',
                'border-neutral-200 dark:border-dark-border-strong',
                'bg-white dark:bg-dark-input',
                disabled ? 'opacity-60' : '',
            ].join(' ')}
        >
            <Text
                className={[
                    'flex-1 font-sans text-base',
                    value
                        ? 'text-neutral-900 dark:text-dark-text'
                        : 'text-neutral-400 dark:text-dark-text-muted',
                ].join(' ')}
                numberOfLines={1}
            >
                {value || placeholder}
            </Text>
            <Ionicons name="chevron-down" size={20} color="#98A2B3" />
        </Pressable>
    );
}
