import { RefreshControl, ScrollView, View } from 'react-native';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToolCards } from '@/hooks/useMaterialRequests';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';
import type { AppStackScreenProps } from '@/navigation/types';
import type { ToolCard } from '@/types/materialRequest.types';
import { ToolCardRow } from './ToolCardRow';

/**
 * Histórico de recebimentos de ferramentas (Controle de EPIs).
 *
 * Lista os cards com `status: 'recebido'`. Cada card oferece "Ver comprovante":
 * abre o PhotoViewer global com as fotos de cada item (URLs resolvidas por
 * `resolveMediaUrl`) seguidas da assinatura (Data URL, passa direto).
 */

type EpiNavigation = AppStackScreenProps<'Epi'>['navigation'];

/** Fotos dos itens (resolvidas) + assinatura ao final. */
function buildProofPhotos(card: ToolCard): string[] {
    const itemPhotos = card.items
        .map((it) => resolveMediaUrl(it.photo_url))
        .filter((u): u is string => !!u);
    const photos = [...itemPhotos];
    if (card.signature_base64) photos.push(card.signature_base64);
    return photos;
}

export function ToolReceivedTab({ navigation }: { navigation: EpiNavigation }) {
    const { data, isLoading, isError, refetch, isRefetching } = useToolCards({ status: 'recebido' });
    const cards = data?.items ?? [];

    const openProof = (card: ToolCard) => {
        const photos = buildProofPhotos(card);
        if (photos.length === 0) return;
        navigation.navigate('PhotoViewer', {
            photos,
            title: card.employee_name ?? `Funcionário ${card.employee_id}`,
        });
    };

    if (isLoading) {
        return (
            <View className="gap-3 p-4">
                {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} width="100%" height={112} radius={16} />
                ))}
            </View>
        );
    }

    if (isError) {
        return (
            <ErrorState
                title="Falha ao carregar"
                description="Não foi possível carregar o histórico de recebimentos."
                onRetry={() => void refetch()}
            />
        );
    }

    return (
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
                    title="Nenhum recebimento registrado"
                    description="Os recebimentos confirmados pelos funcionários aparecem aqui."
                />
            ) : (
                <View className="gap-3">
                    {cards.map((c) => (
                        <ToolCardRow
                            key={`${c.request_id}-${c.employee_id}`}
                            card={c}
                            action={{
                                label: 'Ver comprovante',
                                icon: 'document-text-outline',
                                onPress: () => openProof(c),
                            }}
                        />
                    ))}
                </View>
            )}
        </ScrollView>
    );
}
