import {
    forwardRef,
    useCallback,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { PanResponder, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import {
    Canvas,
    Path,
    Skia,
    useCanvasRef,
    ImageFormat,
    type SkPath,
} from '@shopify/react-native-skia';

/**
 * SignaturePad (mobile) — paridade funcional com o `SignaturePad` do web
 * (`frontend/src/components/features/epi/SignaturePad.tsx`), que captura a
 * assinatura como Data URL de imagem.
 *
 * No RN não há `<canvas>` HTML. Em vez de instalar uma nova dependência
 * (react-native-signature-canvas exigiria react-native-webview), usamos o
 * `@shopify/react-native-skia` — JÁ presente no projeto — para desenhar os
 * traços e exportar um PNG via `makeImageSnapshot().encodeToBase64()`. O
 * resultado é embrulhado como `data:image/png;base64,...`, exatamente o formato
 * exigido pelo backend (`EntregaEPICreate.assinatura_base64` valida
 * `startswith("data:image/")`).
 *
 * O gesto usa `PanResponder` (API nativa do RN, sem dependência extra). Ele
 * reivindica o responder no toque, então funciona mesmo dentro de um
 * ScrollView / bottom sheet sem conflitar com o scroll vertical.
 */

export interface SignaturePadHandle {
    /** Retorna o Data URL PNG da assinatura, ou `null` se vazio. */
    getDataUrl: () => string | null;
    /** Limpa o desenho. */
    clear: () => void;
    /** `true` se não há nenhum traço. */
    isEmpty: () => boolean;
}

interface SignaturePadProps {
    /** Notifica quando o estado vazio muda (para habilitar/desabilitar o botão). */
    onEmptyChange?: (empty: boolean) => void;
    height?: number;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
    function SignaturePad({ onEmptyChange, height = 200 }, ref) {
        const canvasRef = useCanvasRef();
        // Traços já finalizados + o traço em andamento (renderização reativa).
        const [paths, setPaths] = useState<SkPath[]>([]);
        const [current, setCurrent] = useState<SkPath | null>(null);
        // Referência síncrona (o PanResponder é criado uma vez).
        const currentRef = useRef<SkPath | null>(null);
        const emptyRef = useRef(true);

        const setEmpty = useCallback(
            (empty: boolean) => {
                if (emptyRef.current !== empty) {
                    emptyRef.current = empty;
                    onEmptyChange?.(empty);
                }
            },
            [onEmptyChange]
        );

        const panResponder = useMemo(
            () =>
                PanResponder.create({
                    onStartShouldSetPanResponder: () => true,
                    onMoveShouldSetPanResponder: () => true,
                    onPanResponderGrant: (evt) => {
                        const { locationX, locationY } = evt.nativeEvent;
                        const p = Skia.Path.Make();
                        p.moveTo(locationX, locationY);
                        // Ponto único (toque simples) já marca algo visível.
                        p.lineTo(locationX + 0.1, locationY + 0.1);
                        currentRef.current = p;
                        setCurrent(p.copy());
                        setEmpty(false);
                    },
                    onPanResponderMove: (evt) => {
                        const p = currentRef.current;
                        if (!p) return;
                        const { locationX, locationY } = evt.nativeEvent;
                        p.lineTo(locationX, locationY);
                        setCurrent(p.copy());
                    },
                    onPanResponderRelease: () => {
                        const p = currentRef.current;
                        if (p) {
                            setPaths((prev) => [...prev, p]);
                        }
                        currentRef.current = null;
                        setCurrent(null);
                    },
                    onPanResponderTerminate: () => {
                        const p = currentRef.current;
                        if (p) {
                            setPaths((prev) => [...prev, p]);
                        }
                        currentRef.current = null;
                        setCurrent(null);
                    },
                }),
            [setEmpty]
        );

        const clear = useCallback(() => {
            setPaths([]);
            setCurrent(null);
            currentRef.current = null;
            setEmpty(true);
        }, [setEmpty]);

        useImperativeHandle(
            ref,
            () => ({
                clear,
                isEmpty: () => emptyRef.current,
                getDataUrl: () => {
                    if (emptyRef.current) return null;
                    const image = canvasRef.current?.makeImageSnapshot();
                    if (!image) return null;
                    const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
                    if (!base64) return null;
                    return `data:image/png;base64,${base64}`;
                },
            }),
            [canvasRef, clear]
        );

        // Ignora o layout (o Canvas dimensiona pelo container).
        const onLayout = useCallback((_e: LayoutChangeEvent) => {}, []);

        const allPaths = current ? [...paths, current] : paths;

        return (
            <View>
                <View
                    onLayout={onLayout}
                    className="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-dark-border-strong dark:bg-dark-input"
                    style={{ height }}
                    {...panResponder.panHandlers}
                >
                    <Canvas ref={canvasRef} style={{ flex: 1 }}>
                        {allPaths.map((p, i) => (
                            <Path
                                key={i}
                                path={p}
                                color="#111111"
                                style="stroke"
                                strokeWidth={2.5}
                                strokeCap="round"
                                strokeJoin="round"
                            />
                        ))}
                    </Canvas>
                    {emptyRef.current && allPaths.length === 0 ? (
                        <View
                            pointerEvents="none"
                            className="absolute inset-0 items-center justify-center"
                        >
                            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                                Assine com o dedo aqui
                            </Text>
                        </View>
                    ) : null}
                </View>
                <View className="mt-1.5 flex-row justify-end">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Limpar assinatura"
                        onPress={clear}
                        hitSlop={8}
                        className="min-h-[36px] flex-row items-center px-2 active:opacity-70"
                    >
                        <Text className="font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                            Limpar
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }
);
