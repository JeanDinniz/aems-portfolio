import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { EmptyState } from '@/components/ui/EmptyState';

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

    return (
        <View className="gap-4">
            {photos.length > 0 ? (
                <Section title="Fotos da O.S" photos={photos} onPressPhoto={onPressPhoto} />
            ) : null}
            {damagePhotos.length > 0 ? (
                <Section
                    title="Fotos de avaria"
                    photos={damagePhotos}
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
                            source={{ uri }}
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
