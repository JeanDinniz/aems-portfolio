import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/theme';
import { useCancelAppointment } from '@/hooks/useScheduling';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * AGD-05 — CancelAppointmentSheet: cancela o agendamento (ação destrutiva) via
 * `useCancelAppointment().mutateAsync({ id, reason })` → DELETE /scheduling/{id}.
 *
 * Espelha o CancelOSSheet: motivo OPCIONAL (o web cancela só com confirmação,
 * sem campo de motivo). Confirmação clara antes de aplicar.
 */

export interface CancelAppointmentSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface CancelAppointmentSheetProps {
    appointmentId: number;
    /** Chamado após cancelamento bem-sucedido (ex.: voltar para a lista). */
    onCancelled?: () => void;
}

export const CancelAppointmentSheet = forwardRef<
    CancelAppointmentSheetRef,
    CancelAppointmentSheetProps
>(function CancelAppointmentSheet({ appointmentId, onCancelled }, ref) {
    const sheetRef = useRef<SheetRef>(null);
    const toast = useToast();
    const { colors } = useTheme();
    const cancelAppointment = useCancelAppointment();
    const [reason, setReason] = useState('');

    const reset = useCallback(() => setReason(''), []);

    useImperativeHandle(ref, () => ({
        present: () => {
            reset();
            sheetRef.current?.present();
        },
        dismiss: () => sheetRef.current?.dismiss(),
    }));

    const apply = useCallback(async () => {
        try {
            await cancelAppointment.mutateAsync({
                id: appointmentId,
                reason: reason.trim() || undefined,
            });
            sheetRef.current?.dismiss();
            onCancelled?.();
        } catch (err) {
            toast.error(
                getApiErrorMessage(err as Error, 'Não foi possível cancelar o agendamento.')
            );
        }
    }, [cancelAppointment, appointmentId, reason, toast, onCancelled]);

    const isBusy = cancelAppointment.isPending;

    return (
        <Sheet ref={sheetRef} title="Cancelar agendamento" onDismiss={reset}>
            <View className="gap-3 pb-1">
                <View className="flex-row items-start gap-3 rounded-xl bg-error-light p-3 dark:bg-dark-elevated">
                    <Ionicons name="warning" size={20} color="#D92D20" />
                    <Text className="flex-1 font-sans text-sm text-error">
                        Esta ação cancela o agendamento. Confirme apenas se tiver certeza.
                    </Text>
                </View>

                <View>
                    <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        Motivo do cancelamento (opcional)
                    </Text>
                    {/* BottomSheetTextInput: sobe junto com o teclado dentro do sheet. */}
                    <BottomSheetTextInput
                        placeholder="Descreva o motivo..."
                        placeholderTextColor={colors.placeholder}
                        multiline
                        numberOfLines={3}
                        style={{ minHeight: 72, textAlignVertical: 'top' }}
                        value={reason}
                        onChangeText={setReason}
                        editable={!isBusy}
                        className={[
                            'rounded-lg border px-4 py-3 font-sans text-base',
                            'text-neutral-900 dark:text-dark-text',
                            'bg-white dark:bg-dark-input',
                            'border-neutral-200 dark:border-dark-border-strong',
                            !isBusy ? '' : 'opacity-60',
                        ].join(' ')}
                    />
                </View>

                <Button
                    title="Confirmar cancelamento"
                    icon="close-circle-outline"
                    variant="destructive"
                    loading={isBusy}
                    disabled={isBusy}
                    onPress={apply}
                />
                <Button
                    title="Voltar"
                    variant="ghost"
                    disabled={isBusy}
                    onPress={() => sheetRef.current?.dismiss()}
                />
            </View>
        </Sheet>
    );
});
