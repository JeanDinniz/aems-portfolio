import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme';
import { useAdjustRollMeters } from '@/hooks/useInventory';
import type { FilmRoll } from '@/services/api/inventory.service';

/**
 * Ajustar metros restantes (conferência física de estoque) — paridade com o
 * bloco "Ajustar metros" do web (InventoryPage).
 *
 * Corrige o saldo do sistema para bater com o físico, com MOTIVO obrigatório.
 * Dois campos: metros restantes (numérico, aceita vírgula, 0 ≤ valor ≤ total) e
 * motivo (multiline, obrigatório, máx. 200). O consumo NÃO é alterado — só o
 * saldo restante. Sucesso → fecha o sheet e invalida as queries (via hook).
 *
 * Não faz sentido em bobina esgotada — a tela esconde o gatilho nesse caso.
 */

export interface AdjustMetersSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface AdjustMetersSheetProps {
    roll: FilmRoll;
}

const NOTE_MAX = 200;

function fmtMeters(value: number): string {
    return `${value.toFixed(1)}m`;
}

export const AdjustMetersSheet = forwardRef<AdjustMetersSheetRef, AdjustMetersSheetProps>(
    function AdjustMetersSheet({ roll }, ref) {
        const sheetRef = useRef<SheetRef>(null);
        const { colors } = useTheme();
        const adjustRoll = useAdjustRollMeters();

        const [meters, setMeters] = useState<string>('');
        const [note, setNote] = useState<string>('');

        const reset = useCallback(() => {
            // Prefill com o saldo atual (paridade com o web).
            setMeters(String(roll.remaining_meters));
            setNote('');
        }, [roll.remaining_meters]);

        useImperativeHandle(ref, () => ({
            present: () => {
                reset();
                sheetRef.current?.present();
            },
            dismiss: () => sheetRef.current?.dismiss(),
        }));

        const metersValue = Number(meters.replace(',', '.'));
        const metersInvalid =
            meters !== '' && (!Number.isFinite(metersValue) || metersValue < 0);
        const metersExceed = Number.isFinite(metersValue) && metersValue > roll.total_meters;
        const noteEmpty = note.trim().length === 0;
        const isBusy = adjustRoll.isPending;
        const canSubmit =
            meters !== '' && !metersInvalid && !metersExceed && !noteEmpty && !isBusy;

        const submit = useCallback(async () => {
            if (!canSubmit) return;
            try {
                await adjustRoll.mutateAsync({
                    id: roll.id,
                    remaining_meters: metersValue,
                    note: note.trim(),
                });
                sheetRef.current?.dismiss();
            } catch {
                // Toast de erro já é exibido pelo hook (onError).
            }
        }, [canSubmit, adjustRoll, roll.id, metersValue, note]);

        return (
            <Sheet ref={sheetRef} title="Ajustar metros restantes" snapPoints={['70%']}>
                <BottomSheetScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 8 }}
                >
                    <View className="gap-3 pb-1">
                        <Text className="font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                            Corrija o saldo físico da bobina {roll.visual_id}. O consumo já
                            registrado não é alterado.
                        </Text>

                        {/* Metros restantes */}
                        <View>
                            <FieldLabel>Metros restantes *</FieldLabel>
                            <BottomSheetTextInput
                                placeholder={`Ex: ${roll.total_meters}`}
                                placeholderTextColor={colors.placeholder}
                                keyboardType="decimal-pad"
                                value={meters}
                                onChangeText={setMeters}
                                editable={!isBusy}
                                className={inputClasses(isBusy, metersInvalid || metersExceed)}
                            />
                            {metersExceed ? (
                                <Text className="mt-1 font-sans text-xs text-error">
                                    Não pode exceder o total da bobina ({fmtMeters(roll.total_meters)}).
                                </Text>
                            ) : metersInvalid ? (
                                <Text className="mt-1 font-sans text-xs text-error">
                                    Informe um valor igual ou maior que zero.
                                </Text>
                            ) : (
                                <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                    Total da bobina: {fmtMeters(roll.total_meters)}.
                                </Text>
                            )}
                        </View>

                        {/* Motivo (obrigatório) */}
                        <View>
                            <FieldLabel>Motivo *</FieldLabel>
                            <BottomSheetTextInput
                                placeholder="Ex: conferência física — sobra menor que o sistema"
                                placeholderTextColor={colors.placeholder}
                                value={note}
                                onChangeText={setNote}
                                editable={!isBusy}
                                maxLength={NOTE_MAX}
                                multiline
                                className={[inputClasses(isBusy, false), 'min-h-[72px]'].join(' ')}
                                style={{ textAlignVertical: 'top' }}
                            />
                            <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                {note.trim().length}/{NOTE_MAX}
                            </Text>
                        </View>

                        <Button
                            title="Confirmar ajuste"
                            icon="checkmark"
                            loading={isBusy}
                            disabled={!canSubmit}
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
            </Sheet>
        );
    }
);

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
