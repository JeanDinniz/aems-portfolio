import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { PhotoCapture } from '@/components/features/PhotoCapture';
import { SignaturePad, type SignaturePadHandle } from '@/components/features/epi/SignaturePad';
import { useToolCards, useConfirmToolReceipt } from '@/hooks/useMaterialRequests';
import { pruneUploaded } from '@/services/upload/uploadQueue';
import type { ToolCard } from '@/types/materialRequest.types';
import type { Photo } from '@/types/photo.types';
import { ToolCardRow } from './ToolCardRow';

/**
 * Pendências de recebimento de ferramentas (Controle de EPIs).
 *
 * Lista os cards com `status: 'pendente'`. Cada card abre a sheet "Registrar
 * recebimento": além da assinatura (`SignaturePad`), agora EXIGE 1 foto por item
 * (`PhotoCapture` com min/max = 1), refletindo o contrato do backend
 * (`item_photos` com um item_id por foto). As fotos sobem pela fila offline; o
 * gate espera todas terem `url` antes de confirmar.
 */

export function ToolPendingTab() {
    const toast = useToast();
    const { data, isLoading, isError, refetch, isRefetching } = useToolCards({ status: 'pendente' });
    const cards = data?.items ?? [];

    const confirmMutation = useConfirmToolReceipt();
    const [confirmCard, setConfirmCard] = useState<ToolCard | null>(null);
    const [sigEmpty, setSigEmpty] = useState(true);
    // itemId → fotos (min/max 1 por item).
    const [photosByItem, setPhotosByItem] = useState<Record<number, Photo[]>>({});
    const sheetRef = useRef<SheetRef>(null);
    const sigRef = useRef<SignaturePadHandle>(null);

    const openConfirm = (card: ToolCard) => {
        setConfirmCard(card);
        setSigEmpty(true);
        setPhotosByItem({});
        sigRef.current?.clear();
        sheetRef.current?.present();
    };

    const closeConfirm = () => {
        setConfirmCard(null);
        setPhotosByItem({});
        sheetRef.current?.dismiss();
    };

    // Todos os itens têm exatamente 1 foto já enviada (com url).
    const allItemsHavePhoto = confirmCard
        ? confirmCard.items.every((it) => !!photosByItem[it.id]?.[0])
        : false;
    const allPhotosSent = confirmCard
        ? confirmCard.items.every((it) => !!photosByItem[it.id]?.[0]?.url)
        : false;

    const handleConfirm = () => {
        if (!confirmCard) return;

        const signature = sigRef.current?.getDataUrl();
        if (!signature) {
            toast.error('Colete a assinatura antes de confirmar.');
            return;
        }
        if (!allItemsHavePhoto) {
            toast.error('Adicione 1 foto para cada item.');
            return;
        }
        if (!allPhotosSent) {
            toast.show('Aguarde o envio das fotos terminar.', { variant: 'warning' });
            return;
        }

        const item_photos = confirmCard.items.map((it) => ({
            item_id: it.id,
            photo_url: photosByItem[it.id][0].url as string,
        }));
        const consumedIds = confirmCard.items
            .map((it) => photosByItem[it.id][0].id)
            .filter(Boolean);

        confirmMutation.mutate(
            {
                request_id: confirmCard.request_id,
                employee_id: confirmCard.employee_id,
                signature_base64: signature,
                item_photos,
            },
            {
                onSuccess: () => {
                    void pruneUploaded(consumedIds);
                    closeConfirm();
                },
            }
        );
    };

    const confirmDisabled =
        sigEmpty || !allItemsHavePhoto || !allPhotosSent || confirmMutation.isPending;

    return (
        <View className="flex-1">
            {isLoading ? (
                <View className="gap-3 p-4">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} width="100%" height={112} radius={16} />
                    ))}
                </View>
            ) : isError ? (
                <ErrorState
                    title="Falha ao carregar"
                    description="Não foi possível carregar os recebimentos pendentes."
                    onRetry={() => void refetch()}
                />
            ) : (
                <ScrollView
                    className="flex-1"
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                    }
                >
                    {cards.length === 0 ? (
                        <EmptyState
                            icon="checkmark-done-outline"
                            title="Nenhum recebimento pendente"
                            description="Os cards aparecem quando uma ferramenta de um pedido é vinculada a um funcionário. Vincule no módulo Pedidos de Material."
                        />
                    ) : (
                        <View className="gap-3">
                            {cards.map((c) => (
                                <ToolCardRow
                                    key={`${c.request_id}-${c.employee_id}`}
                                    card={c}
                                    action={{
                                        label: 'Registrar recebimento',
                                        icon: 'pencil-outline',
                                        onPress: () => openConfirm(c),
                                    }}
                                />
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}

            <Sheet ref={sheetRef} title="Registrar recebimento" snapPoints={['90%']}>
                {confirmCard ? (
                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingBottom: 24 }}
                        showsVerticalScrollIndicator={false}
                    >
                        <View className="mb-3 rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-dark-elevated">
                            <Text className="font-sans text-sm text-neutral-600 dark:text-dark-text-muted">
                                Eu,{' '}
                                <Text className="font-sans-semibold">
                                    {confirmCard.employee_name ??
                                        `Funcionário ${confirmCard.employee_id}`}
                                </Text>
                                , declaro ter recebido as ferramentas/insumos abaixo em perfeitas
                                condições de uso. Registre 1 foto por item.
                            </Text>
                        </View>

                        <View className="mb-3 gap-3">
                            {confirmCard.items.map((it) => (
                                <View
                                    key={it.id}
                                    className="gap-2 rounded-lg border border-neutral-100 bg-white px-3 py-3 dark:border-dark-border-soft dark:bg-dark-surface"
                                >
                                    <View className="flex-row items-center gap-1.5">
                                        <Ionicons name="build-outline" size={14} color="#98A2B3" />
                                        <Text className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text">
                                            {it.name}
                                        </Text>
                                        <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                                            × {it.quantity}
                                        </Text>
                                        {it.notes ? (
                                            <Text
                                                numberOfLines={1}
                                                className="flex-1 font-sans text-xs italic text-neutral-400 dark:text-dark-text-muted"
                                            >
                                                — {it.notes}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <PhotoCapture
                                        label="Foto do item"
                                        value={photosByItem[it.id] ?? []}
                                        onChange={(photos) =>
                                            setPhotosByItem((prev) => ({ ...prev, [it.id]: photos }))
                                        }
                                        minPhotos={1}
                                        maxPhotos={1}
                                        osDraftId={`tr-${confirmCard.request_id}-${confirmCard.employee_id}-${it.id}`}
                                    />
                                </View>
                            ))}
                        </View>

                        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                            Assinatura *
                        </Text>
                        <SignaturePad ref={sigRef} onEmptyChange={setSigEmpty} />

                        <View className="mt-4 gap-2">
                            <Button
                                title="Confirmar recebimento"
                                icon="checkmark-circle-outline"
                                loading={confirmMutation.isPending}
                                disabled={confirmDisabled}
                                onPress={handleConfirm}
                            />
                            <Button
                                title="Cancelar"
                                variant="secondary"
                                disabled={confirmMutation.isPending}
                                onPress={closeConfirm}
                            />
                        </View>
                    </ScrollView>
                ) : null}
            </Sheet>
        </View>
    );
}
