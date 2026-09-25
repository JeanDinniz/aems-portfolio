import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { EmptyState } from '@/components/ui/EmptyState';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';
import { mediaHeaders } from '@/lib/mediaSource';

/**
 * OS-04 — Grade de miniaturas das fotos da O.S.
 *
 * Renderiza a seção "Fotos da O.S" e, se houver, "Fotos de avaria".
 * Ao tocar numa miniatura, chama `onPressPhoto` com a lista da SEÇÃO tocada
 * (para o viewer paginar dentro daquela seção) e o índice tocado.
 */

export interface PhotoGridProps {
    photos: string[];
    damagePhotos?: string[];
    /** Toque numa miniatura → abre o viewer com a lista da seção + índice. */
    onPressPhoto: (sectionPhotos: string[], index: number) => void;
}

export function PhotoGrid({ photos, damagePhotos = [], onPressPhoto }: PhotoGridProps) {
    const hasAny = photos.length > 0 || damagePhotos.length > 0;

    if (!hasAny) {
        return (
            <EmptyState
                icon="images-outline"
                title="Sem fotos"
                description="Nenhuma foto registrada nesta O.S."
            />
        );
    }

    // Fotos vêm de `/uploads` (protegido/host local em dev). Resolve aqui para que
    // tanto as miniaturas quanto o viewer (via onPressPhoto) recebam URLs válidas.
    const resolvedPhotos = photos.map((uri) => resolveMediaUrl(uri));
    const resolvedDamagePhotos = damagePhotos.map((uri) => resolveMediaUrl(uri));

    return (
        <View className="gap-4">
            {resolvedPhotos.length > 0 ? (
                <Section title="Fotos da O.S" photos={resolvedPhotos} onPressPhoto={onPressPhoto} />
            ) : null}
            {resolvedDamagePhotos.length > 0 ? (
                <Section
                    title="Fotos de avaria"
                    photos={resolvedDamagePhotos}
                    onPressPhoto={onPressPhoto}
                />
            ) : null}
        </View>
    );
}

interface SectionProps {
    title: string;
    photos: string[];
    onPressPhoto: (sectionPhotos: string[], index: number) => void;
}

function Section({ title, photos, onPressPhoto }: SectionProps) {
    return (
        <View className="gap-2">
            <Text className="font-sans-bold text-sm text-neutral-700 dark:text-dark-text">
                {`${title} (${photos.length})`}
            </Text>
            <View className="flex-row flex-wrap gap-2">
                {photos.map((uri, index) => (
                    <Pressable
                        key={`${uri}-${index}`}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`${title}, foto ${index + 1} de ${photos.length}`}
                        onPress={() => onPressPhoto(photos, index)}
                        className="h-24 w-24 overflow-hidden rounded-lg bg-neutral-100 active:opacity-80 dark:bg-dark-elevated"
                    >
                        <Image
                            source={{ uri, headers: mediaHeaders() }}
                            style={{ width: '100%', height: '100%' }}
                            contentFit="cover"
                            transition={120}
                        />
                    </Pressable>
                ))}
            </View>
        </View>
    );
}
