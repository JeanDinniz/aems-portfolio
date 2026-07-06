import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTransferRoll } from '@/hooks/useInventory';
import { useStores } from '@/hooks/useStores';
import type { InventoryStackScreenProps } from '@/navigation/types';

/**
 * INV-05 — TransferRollScreen: transfere a bobina para outra loja.
 *
 * Tela CHEIA (não bottom-sheet): a lista de lojas pode ter 14+ itens e precisa
 * rolar; uma lista rolável dentro de um bottom-sheet briga com o gesto do sheet
 * (só as primeiras lojas apareciam). Aqui o `FlatList` rola nativamente.
 *
 * Lista a rede TODA (`useStores().allStores`, igual ao web), exceto a loja atual
 * da bobina. Chama `useTransferRoll().mutateAsync({ rollId, targetStoreId })`;
 * o toast fica no hook e, ao concluir, volta ao detalhe (que revalida).
 */
export function TransferRollScreen({ route, navigation }: InventoryStackScreenProps<'TransferRoll'>) {
    const { id, currentStoreId } = route.params;
    // `allStores` = lista COMPLETA do backend, não a filtrada por perfil.
    const { allStores } = useStores();
    const transferRoll = useTransferRoll();
    const [targetStoreId, setTargetStoreId] = useState<number | null>(null);

    const storeOptions = useMemo(
        () => allStores.filter((s) => s.id !== currentStoreId).map((s) => ({ value: s.id, label: s.name })),
        [allStores, currentStoreId]
    );

    const isBusy = transferRoll.isPending;

    const apply = useCallback(async () => {
        if (!targetStoreId) return;
        try {
            await transferRoll.mutateAsync({ rollId: id, targetStoreId });
            navigation.goBack();
        } catch {
            // Toast de erro já é exibido pelo hook (onError).
        }
    }, [transferRoll, id, targetStoreId, navigation]);

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Transferir bobina" onBack={() => navigation.goBack()} />

            <View className="flex-row items-start gap-3 mx-4 mt-4 rounded-xl bg-white p-3 dark:bg-dark-surface">
                <Ionicons name="swap-horizontal" size={20} color="#98A2B3" />
                <Text className="flex-1 font-sans text-sm text-neutral-600 dark:text-dark-text-muted">
                    A bobina e seu estoque restante passam para a loja de destino.
                </Text>
            </View>

            <Text className="mx-4 mb-1 mt-4 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                Loja de destino
            </Text>

            {storeOptions.length === 0 ? (
                <EmptyState
                    icon="business-outline"
                    title="Nenhuma loja disponível"
                    description="Não há outra loja para receber esta bobina."
                />
            ) : (
                <FlatList
                    data={storeOptions}
                    keyExtractor={(item) => String(item.value)}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                    ItemSeparatorComponent={() => (
                        <View className="h-px bg-neutral-100 dark:bg-dark-border-soft" />
                    )}
                    renderItem={({ item }) => {
                        const selected = item.value === targetStoreId;
                        return (
                            <Pressable
                                accessibilityRole="radio"
                                accessibilityState={{ selected }}
                                accessibilityLabel={item.label}
                                disabled={isBusy}
                                onPress={() => setTargetStoreId(item.value)}
                                className="min-h-[52px] flex-row items-center gap-3 bg-white px-4 py-3 active:opacity-80 dark:bg-dark-surface"
                            >
                                <Ionicons
                                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                                    size={22}
                                    color={selected ? '#D47F00' : '#98A2B3'}
                                />
                                <Text
                                    className={`flex-1 font-sans text-base ${
                                        selected
                                            ? 'font-sans-semibold text-brand-black dark:text-brand'
                                            : 'text-neutral-700 dark:text-dark-text'
                                    }`}
                                >
                                    {item.label}
                                </Text>
                            </Pressable>
                        );
                    }}
                />
            )}

            {/* Rodapé fixo de ação */}
            <View className="border-t border-neutral-100 bg-white px-4 py-3 dark:border-dark-border-soft dark:bg-dark-surface">
                <Button
                    title="Confirmar transferência"
                    icon="checkmark"
                    loading={isBusy}
                    disabled={isBusy || !targetStoreId}
                    onPress={apply}
                />
            </View>
        </View>
    );
}
