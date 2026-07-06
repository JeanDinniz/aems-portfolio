import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useTheme } from '@/theme';
import { useCancelServiceOrder } from '@/hooks/useServiceOrders';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * OS-09 — CancelOSSheet: cancela a O.S. (ação destrutiva) via
 * `useCancelServiceOrder().mutateAsync({ id, reason })` → DELETE /service-orders/{id}?reason=.
 *
 * Motivo opcional (textarea). Confirmação clara antes de aplicar.
 */

export interface CancelOSSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface CancelOSSheetProps {
    serviceOrderId: number;
    /** Chamado após cancelamento bem-sucedido (ex.: voltar para a lista). */
    onCancelled?: () => void;
}

export const CancelOSSheet = forwardRef<CancelOSSheetRef, CancelOSSheetProps>(
    function CancelOSSheet({ serviceOrderId, onCancelled }, ref) {
        const sheetRef = useRef<SheetRef>(null);
        const toast = useToast();
        const { colors } = useTheme();
        const cancelOrder = useCancelServiceOrder();
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
                await cancelOrder.mutateAsync({
                    id: serviceOrderId,
                    reason: reason.trim() || undefined,
                });
                toast.success('O.S. cancelada.');
                sheetRef.current?.dismiss();
                onCancelled?.();
            } catch (err) {
                toast.error(getApiErrorMessage(err as Error, 'Não foi possível cancelar a O.S.'));
            }
        }, [cancelOrder, serviceOrderId, reason, toast, onCancelled]);

        const isBusy = cancelOrder.isPending;

        return (
            <Sheet ref={sheetRef} title="Cancelar O.S" onDismiss={reset}>
                <View className="gap-3 pb-1">
                    <View className="flex-row items-start gap-3 rounded-xl bg-error-light p-3 dark:bg-dark-elevated">
                        <Ionicons name="warning" size={20} color="#D92D20" />
                        <Text className="flex-1 font-sans text-sm text-error">
                            Esta ação cancela a Ordem de Serviço. Confirme apenas se tiver certeza.
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
    }
);
