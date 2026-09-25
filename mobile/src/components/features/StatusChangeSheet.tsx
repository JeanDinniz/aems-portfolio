import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { useUndoWrong, useUpdateServiceOrderStatus } from '@/hooks/useServiceOrders';
import { getApiErrorMessage } from '@/lib/api-error';
import type { ServiceOrderStatus } from '@/types/service-order.types';

/**
 * OS-08 — StatusChangeSheet: troca de status da O.S. via transições válidas.
 *
 * Módulo de "Lançar O.S": acompanhamento BÁSICO de status (espelha o dropdown
 * simples do web `ServiceOrdersPage`). "Finalizado" aqui é uma troca de status
 * SIMPLES (sem foto/bobina/funcionário) — a finalização RICA pertence ao módulo
 * de Agendamento (FinalizeOSScreen).
 *
 * Transições do backend (workflows.py), em status FRONTEND (ready → completed):
 *   waiting → doing | ready | wrong
 *   doing   → waiting | ready | wrong
 *   wrong   → desfazer (undo-wrong: restaura o status anterior, ex.: Finalizado)
 *   ready   → wrong                  (reverter um finalizado)
 *
 * `cancelled` NÃO é transição de status — vai pela rota DELETE (CancelOSSheet).
 *
 * Aplica via `useUpdateServiceOrderStatus().mutateAsync({ id, status, extras })`,
 * que converte F2B no service. `notes` é opcional (vai em `extras.notes`).
 * Confirma antes de aplicar (passo de confirmação dentro do próprio sheet).
 */

export interface StatusChangeSheetRef {
    present: () => void;
    dismiss: () => void;
}

export interface StatusChangeSheetProps {
    serviceOrderId: number;
    currentStatus: ServiceOrderStatus;
    /** Chamado após troca de status bem-sucedida. */
    onChanged?: () => void;
}

interface TransitionOption {
    status: ServiceOrderStatus;
    label: string;
    description: string;
    icon: keyof typeof Ionicons.glyphMap;
    tone: 'brand' | 'neutral' | 'warning';
    /**
     * Quando true, a ação NÃO é uma troca de status genérica: chama o endpoint
     * dedicado `undo-wrong`, que restaura o status anterior ao "Lançado Errado".
     * `status` aqui é só fallback de exibição.
     */
    undoWrong?: boolean;
}

/**
 * Transições oferecidas no sheet (acompanhamento básico, sem `cancelled`).
 * "Finalizado" (`ready`) é troca de status simples; `ready → wrong` permite
 * reverter um finalizado lançado errado. Sair de `wrong` usa `undo-wrong`
 * (restaura o status anterior), nunca o `waiting` genérico.
 */
const TRANSITIONS: Record<ServiceOrderStatus, TransitionOption[]> = {
    waiting: [
        {
            status: 'doing',
            label: 'Iniciar O.S',
            description: 'Marcar como "Fazendo"',
            icon: 'play',
            tone: 'brand',
        },
        {
            status: 'ready',
            label: 'Finalizado',
            description: 'Marcar como "Finalizado"',
            icon: 'checkmark-done',
            tone: 'brand',
        },
        {
            status: 'wrong',
            label: 'Lançado Errado',
            description: 'Marcar como lançamento incorreto',
            icon: 'alert-circle-outline',
            tone: 'warning',
        },
    ],
    doing: [
        {
            status: 'ready',
            label: 'Finalizado',
            description: 'Marcar como "Finalizado"',
            icon: 'checkmark-done',
            tone: 'brand',
        },
        {
            status: 'waiting',
            label: 'Voltar para Aguardando',
            description: 'Reverter o início da execução',
            icon: 'arrow-undo-outline',
            tone: 'neutral',
        },
        {
            status: 'wrong',
            label: 'Lançado Errado',
            description: 'Marcar como lançamento incorreto',
            icon: 'alert-circle-outline',
            tone: 'warning',
        },
    ],
    wrong: [
        {
            status: 'waiting',
            label: 'Desfazer Lançado Errado',
            description: 'Restaura o status anterior (ex.: Finalizado)',
            icon: 'arrow-undo-outline',
            tone: 'brand',
            undoWrong: true,
        },
    ],
    ready: [
        {
            status: 'wrong',
            label: 'Lançado Errado',
            description: 'Reverter finalização incorreta',
            icon: 'alert-circle-outline',
            tone: 'warning',
        },
    ],
    // O.S. nascida com status "Duplicado": resolve-se voltando para Aguardando.
    duplicate: [
        {
            status: 'waiting',
            label: 'Resolver duplicidade',
            description: 'Mover para "Aguardando"',
            icon: 'copy-outline',
            tone: 'brand',
        },
    ],
    cancelled: [],
};

const TONE_ICON_BG: Record<TransitionOption['tone'], string> = {
    brand: 'bg-primary-50 dark:bg-dark-surface',
    neutral: 'bg-neutral-100 dark:bg-dark-elevated',
    warning: 'bg-warning-light dark:bg-dark-elevated',
};
const TONE_ICON_COLOR: Record<TransitionOption['tone'], string> = {
    brand: '#D47F00',
    neutral: '#667085',
    warning: '#B54708',
};

const STATUS_LABEL: Record<ServiceOrderStatus, string> = {
    waiting: 'Aguardando',
    doing: 'Fazendo',
    ready: 'Finalizado',
    wrong: 'Lançado Errado',
    cancelled: 'Cancelada',
    duplicate: 'Duplicado',
};

export const StatusChangeSheet = forwardRef<StatusChangeSheetRef, StatusChangeSheetProps>(
    function StatusChangeSheet({ serviceOrderId, currentStatus, onChanged }, ref) {
        const sheetRef = useRef<SheetRef>(null);
        const toast = useToast();
        const updateStatus = useUpdateServiceOrderStatus();
        const undoWrong = useUndoWrong();

        // Passo de confirmação: null = lista de transições; senão = confirmar alvo.
        const [pending, setPending] = useState<TransitionOption | null>(null);
        const [notes, setNotes] = useState('');

        const reset = useCallback(() => {
            setPending(null);
            setNotes('');
        }, []);

        useImperativeHandle(ref, () => ({
            present: () => {
                reset();
                sheetRef.current?.present();
            },
            dismiss: () => sheetRef.current?.dismiss(),
        }));

        const options = TRANSITIONS[currentStatus] ?? [];

        const apply = useCallback(async () => {
            if (!pending) return;
            try {
                if (pending.undoWrong) {
                    await undoWrong.mutateAsync(serviceOrderId);
                    toast.success('Lançado Errado desfeito — status anterior restaurado.');
                } else {
                    await updateStatus.mutateAsync({
                        id: serviceOrderId,
                        status: pending.status,
                        extras: notes.trim() ? { notes: notes.trim() } : undefined,
                    });
                    toast.success(`Status alterado para "${STATUS_LABEL[pending.status]}".`);
                }
                sheetRef.current?.dismiss();
                onChanged?.();
            } catch (err) {
                toast.error(getApiErrorMessage(err as Error, 'Não foi possível alterar o status.'));
            }
        }, [pending, undoWrong, updateStatus, serviceOrderId, notes, toast, onChanged]);

        const isBusy = updateStatus.isPending || undoWrong.isPending;

        return (
            <Sheet ref={sheetRef} title="Alterar status" onDismiss={reset}>
                {pending ? (
                    // ─── Confirmação ──────────────────────────────────────
                    <View className="gap-3 pb-1">
                        {pending.undoWrong ? (
                            <Text className="font-sans text-sm text-neutral-600 dark:text-dark-text-muted">
                                Desfazer o{' '}
                                <Text className="font-sans-semibold text-neutral-800 dark:text-dark-text">
                                    Lançado Errado
                                </Text>{' '}
                                e restaurar o status anterior desta O.S. (ex.: Finalizado)?
                            </Text>
                        ) : (
                            <Text className="font-sans text-sm text-neutral-600 dark:text-dark-text-muted">
                                Confirmar mudança de{' '}
                                <Text className="font-sans-semibold text-neutral-800 dark:text-dark-text">
                                    {STATUS_LABEL[currentStatus]}
                                </Text>{' '}
                                para{' '}
                                <Text className="font-sans-semibold text-neutral-800 dark:text-dark-text">
                                    {STATUS_LABEL[pending.status]}
                                </Text>
                                ?
                            </Text>
                        )}

                        {!pending.undoWrong && (
                            <TextField
                                label="Observação (opcional)"
                                placeholder="Motivo ou nota desta mudança..."
                                multiline
                                numberOfLines={3}
                                style={{ minHeight: 72, textAlignVertical: 'top' }}
                                value={notes}
                                onChangeText={setNotes}
                                editable={!isBusy}
                            />
                        )}

                        <Button
                            title="Confirmar"
                            icon="checkmark"
                            loading={isBusy}
                            disabled={isBusy}
                            onPress={apply}
                        />
                        <Button
                            title="Voltar"
                            variant="ghost"
                            disabled={isBusy}
                            onPress={() => setPending(null)}
                        />
                    </View>
                ) : (
                    // ─── Lista de transições ──────────────────────────────
                    <View className="gap-2 pb-1">
                        {options.length === 0 ? (
                            <Text className="py-4 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                                Nenhuma mudança de status disponível.
                            </Text>
                        ) : (
                            options.map((opt) => (
                                <Pressable
                                    key={opt.status}
                                    accessibilityRole="button"
                                    accessibilityLabel={opt.label}
                                    accessibilityHint={opt.description}
                                    onPress={() => setPending(opt)}
                                    className="min-h-[56px] flex-row items-center gap-3 rounded-xl bg-neutral-50 px-3 py-3 active:opacity-70 dark:bg-dark-elevated"
                                >
                                    <View
                                        className={`h-10 w-10 items-center justify-center rounded-full ${TONE_ICON_BG[opt.tone]}`}
                                    >
                                        <Ionicons
                                            name={opt.icon}
                                            size={20}
                                            color={TONE_ICON_COLOR[opt.tone]}
                                        />
                                    </View>
                                    <View className="flex-1">
                                        <Text className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text">
                                            {opt.label}
                                        </Text>
                                        <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                            {opt.description}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
                                </Pressable>
                            ))
                        )}
                    </View>
                )}
            </Sheet>
        );
    }
);
