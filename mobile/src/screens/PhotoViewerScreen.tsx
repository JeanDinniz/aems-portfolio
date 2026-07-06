import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    Text,
    View,
    useWindowDimensions,
    type ListRenderItemInfo,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

import type { AppStackScreenProps } from '@/navigation/types';

/**
 * OS-04 — Visualizador de fotos em tela cheia (zoom/pan + swipe).
 *
 * - Swipe horizontal entre fotos via FlatList paginada.
 * - Pinch-to-zoom + pan na foto atual (gesture-handler + reanimated).
 * - Duplo toque alterna zoom 1x ↔ 2.5x.
 * - Botão de fechar e contador "i / n".
 *
 * Registrada como rota global pelo FEAT. Consome `AppStackScreenProps<'PhotoViewer'>`.
 * route.params: { photos: string[]; index?: number; title?: string }.
 */

const MAX_SCALE = 4;
const MIN_SCALE = 1;
const DOUBLE_TAP_SCALE = 2.5;

export function PhotoViewerScreen({ route, navigation }: AppStackScreenProps<'PhotoViewer'>) {
    const { photos, index = 0, title } = route.params;
    const { width, height } = useWindowDimensions();
    const listRef = useRef<FlatList<string>>(null);
    const [current, setCurrent] = useState(index);

    const onMomentumEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const page = Math.round(e.nativeEvent.contentOffset.x / width);
            setCurrent(page);
        },
        [width]
    );

    const renderItem = useCallback(
        ({ item }: ListRenderItemInfo<string>) => (
            <ZoomablePhoto uri={item} width={width} height={height} />
        ),
        [width, height]
    );

    return (
        <View className="flex-1 bg-black">
            <FlatList
                ref={listRef}
                data={photos}
                keyExtractor={(uri, i) => `${uri}-${i}`}
                renderItem={renderItem}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={index}
                getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
                onMomentumScrollEnd={onMomentumEnd}
            />

            {/* Barra superior */}
            <SafeAreaView edges={['top']} className="absolute inset-x-0 top-0">
                <View className="flex-row items-center justify-between px-4 py-2">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Fechar visualizador"
                        onPress={() => navigation.goBack()}
                        className="h-11 w-11 items-center justify-center rounded-full bg-black/50 active:opacity-70"
                    >
                        <Ionicons name="close" size={24} color="#FFFFFF" />
                    </Pressable>

                    <View className="items-center">
                        {title ? (
                            <Text className="font-sans-semibold text-sm text-white" numberOfLines={1}>
                                {title}
                            </Text>
                        ) : null}
                        {photos.length > 1 ? (
                            <Text className="font-sans text-xs text-white/70">
                                {`${current + 1} / ${photos.length}`}
                            </Text>
                        ) : null}
                    </View>

                    {/* Espaçador para centralizar o título */}
                    <View className="h-11 w-11" />
                </View>
            </SafeAreaView>
        </View>
    );
}

interface ZoomablePhotoProps {
    uri: string;
    width: number;
    height: number;
}

function ZoomablePhoto({ uri, width, height }: ZoomablePhotoProps) {
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    const pinch = Gesture.Pinch()
        .onUpdate((e) => {
            const next = savedScale.value * e.scale;
            scale.value = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
        })
        .onEnd(() => {
            savedScale.value = scale.value;
            if (scale.value <= MIN_SCALE) {
                scale.value = withTiming(1);
                savedScale.value = 1;
                translateX.value = withTiming(0);
                translateY.value = withTiming(0);
                savedTranslateX.value = 0;
                savedTranslateY.value = 0;
            }
        });

    const pan = Gesture.Pan()
        .minPointers(1)
        .maxPointers(2)
        .onUpdate((e) => {
            // Só permite pan quando há zoom (senão o swipe da lista assume).
            if (scale.value <= MIN_SCALE) return;
            translateX.value = savedTranslateX.value + e.translationX;
            translateY.value = savedTranslateY.value + e.translationY;
        })
        .onEnd(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
            if (scale.value > MIN_SCALE) {
                scale.value = withTiming(1);
                savedScale.value = 1;
                translateX.value = withTiming(0);
                translateY.value = withTiming(0);
                savedTranslateX.value = 0;
                savedTranslateY.value = 0;
            } else {
                scale.value = withTiming(DOUBLE_TAP_SCALE);
                savedScale.value = DOUBLE_TAP_SCALE;
            }
        });

    // Pan só "vence" o swipe da FlatList quando há zoom; o gesture-handler
    // resolve a composição. Pinch + pan simultâneos; double-tap exclusivo.
    const composed = Gesture.Race(
        doubleTap,
        Gesture.Simultaneous(pinch, pan)
    );

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    return (
        <GestureDetector gesture={composed}>
            <Animated.View
                style={[{ width, height, justifyContent: 'center', alignItems: 'center' }, animatedStyle]}
            >
                <Image
                    source={{ uri }}
                    style={{ width, height }}
                    contentFit="contain"
                    transition={150}
                    cachePolicy="memory-disk"
                    onLoadStart={() => {
                        setLoading(true);
                        setFailed(false);
                    }}
                    onLoadEnd={() => setLoading(false)}
                    onError={() => {
                        setLoading(false);
                        setFailed(true);
                    }}
                    accessibilityLabel="Foto ampliada"
                />

                {/* Overlay de carregamento/erro — atrás dos gestos, não recebe toque */}
                {loading || failed ? (
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {failed ? (
                            <View className="items-center px-6">
                                <Ionicons name="image-outline" size={40} color="rgba(255,255,255,0.6)" />
                                <Text className="mt-2 text-center font-sans text-sm text-white/70">
                                    Não foi possível carregar a imagem
                                </Text>
                            </View>
                        ) : (
                            <ActivityIndicator size="large" color="#FFFFFF" />
                        )}
                    </View>
                ) : null}
            </Animated.View>
        </GestureDetector>
    );
}
