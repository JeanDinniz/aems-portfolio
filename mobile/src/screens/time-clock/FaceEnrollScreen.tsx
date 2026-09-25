import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useEnrollFace } from '@/hooks/useTimeClock';
import {
    captureFromCamera,
    CaptureCancelled,
    PermissionDeniedError,
} from '@/services/camera/capturePhoto';
import {
    generateFaceEmbedding,
    FaceEmbeddingError,
    FaceModelUnavailableError,
} from '@/services/face/faceEmbedding';
import { getApiErrorMessage } from '@/lib/api-error';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * FaceEnrollScreen — Cadastro do rosto de referência do Ponto (Fase 1).
 *
 * Dois passos, uma tela:
 *   1. CONSENTIMENTO (LGPD): explica que o rosto é usado para conferir a
 *      identidade na batida, que só um "código do rosto" (não a foto) é
 *      guardado, e exige aceite explícito antes de prosseguir.
 *   2. CADASTRO: captura selfie frontal → gera o embedding NO APARELHO (pipeline
 *      `generateFaceEmbedding`) → `POST /time-clock/enroll-face` com o embedding +
 *      consent → sucesso ("Rosto cadastrado").
 *
 * O embedding é gerado localmente; a FOTO nunca é enviada ao backend. Erros
 * (sem rosto, modelo indisponível, API) exibem mensagem clara e mantêm o usuário
 * na tela para tentar de novo. Ao concluir, volta para a tela anterior (Ponto),
 * cuja query `['time-clock','me']` foi invalidada pela mutation.
 */

type Phase = 'idle' | 'camera' | 'embedding' | 'enrolling';

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
    camera: 'Abrindo a câmera...',
    embedding: 'Analisando o rosto...',
    enrolling: 'Cadastrando...',
};

export function FaceEnrollScreen({ navigation }: AppStackScreenProps<'FaceEnroll'>) {
    const toast = useToast();
    const enroll = useEnrollFace();

    const [consented, setConsented] = useState(false);
    const [phase, setPhase] = useState<Phase>('idle');
    const isBusy = phase !== 'idle' || enroll.isPending;

    const runEnroll = useCallback(async () => {
        if (!consented || isBusy) return;

        try {
            // 1) Selfie frontal (mesma captura do Ponto — suprime o re-bloqueio
            //    biométrico no vaivém da câmera).
            setPhase('camera');
            const asset = await captureFromCamera('front');

            // 2) Embedding NO APARELHO (detecção + recorte + modelo TFLite).
            setPhase('embedding');
            const embedding = await generateFaceEmbedding(
                asset.uri,
                asset.width ?? 0,
                asset.height ?? 0
            );

            // 3) Cadastro no backend (só o "código do rosto" + consentimento).
            setPhase('enrolling');
            await enroll.mutateAsync({ embedding, consent: true });

            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            toast.success('Rosto cadastrado com sucesso!');
            navigation.goBack();
        } catch (error) {
            // Cancelou a câmera: fluxo normal, sem erro.
            if (error instanceof CaptureCancelled) return;

            if (error instanceof PermissionDeniedError) {
                toast.error(`${error.message} Habilite nas configurações do aparelho.`);
                return;
            }
            if (
                error instanceof FaceEmbeddingError ||
                error instanceof FaceModelUnavailableError
            ) {
                toast.error(error.message);
                return;
            }
            // Erro da API (422 sem vínculo/sem consentimento, etc.): exibe o detail.
            toast.error(getApiErrorMessage(error as Error, 'Não foi possível cadastrar o rosto.'));
        } finally {
            setPhase('idle');
        }
    }, [consented, isBusy, enroll, toast, navigation]);

    const busyLabel = phase !== 'idle' ? PHASE_LABEL[phase] : 'Processando...';

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Cadastrar Rosto" onBack={() => navigation.goBack()} />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            >
                {/* ─── Ilustração / cabeçalho ─────────────────────────────── */}
                <View className="mb-5 items-center">
                    <View className="h-20 w-20 items-center justify-center rounded-full bg-brand/15">
                        <Ionicons name="scan-outline" size={40} color="#F5B800" />
                    </View>
                    <Text className="mt-3 text-center font-display-bold text-xl text-neutral-900 dark:text-dark-text">
                        Reconhecimento facial no ponto
                    </Text>
                    <Text className="mt-1 text-center font-sans text-sm text-neutral-500 dark:text-dark-text-muted">
                        Cadastre seu rosto uma vez para confirmar sua identidade nas batidas.
                    </Text>
                </View>

                {/* ─── Aviso LGPD / consentimento ─────────────────────────── */}
                <Card className="mb-4">
                    <Text className="mb-2 font-sans-bold text-sm uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
                        Como seus dados são usados
                    </Text>
                    <View className="gap-3">
                        <ConsentRow
                            icon="finger-print-outline"
                            text="Seu rosto será usado apenas para conferir sua identidade ao bater o ponto."
                        />
                        <ConsentRow
                            icon="lock-closed-outline"
                            text="Guardamos somente um “código do rosto” (um conjunto de números). A foto NÃO é armazenada nem enviada."
                        />
                        <ConsentRow
                            icon="phone-portrait-outline"
                            text="O código é gerado no seu aparelho a partir de uma selfie."
                        />
                        <ConsentRow
                            icon="shield-checkmark-outline"
                            text="Você pode falar com o administrador para remover seu cadastro a qualquer momento."
                        />
                    </View>
                </Card>

                {/* Aceite explícito (toggle) */}
                <Card
                    className="mb-5"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: consented }}
                    accessibilityLabel="Aceito o uso do reconhecimento facial no ponto"
                    onTouchEnd={() => !isBusy && setConsented((v) => !v)}
                >
                    <View className="flex-row items-center gap-3">
                        <View
                            className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
                                consented
                                    ? 'border-brand bg-brand'
                                    : 'border-neutral-300 dark:border-dark-border'
                            }`}
                        >
                            {consented ? (
                                <Ionicons name="checkmark" size={16} color="#1A1A1A" />
                            ) : null}
                        </View>
                        <Text className="flex-1 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                            Li e concordo com o uso do reconhecimento facial no ponto.
                        </Text>
                    </View>
                </Card>

                {/* ─── Ação ───────────────────────────────────────────────── */}
                <Button
                    title={isBusy ? busyLabel : 'Aceito e cadastrar'}
                    icon="camera-outline"
                    loading={isBusy}
                    disabled={!consented || isBusy}
                    onPress={runEnroll}
                />
                {isBusy ? (
                    <Text
                        accessibilityLiveRegion="polite"
                        className="mt-2 text-center font-sans text-xs text-neutral-400"
                    >
                        {busyLabel}
                    </Text>
                ) : (
                    <Text className="mt-3 text-center font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        Enquadre bem o rosto, com boa iluminação, sem óculos escuros ou máscara.
                    </Text>
                )}
            </ScrollView>
        </View>
    );
}

interface ConsentRowProps {
    icon: keyof typeof Ionicons.glyphMap;
    text: string;
}

function ConsentRow({ icon, text }: ConsentRowProps) {
    return (
        <View className="flex-row items-start gap-3">
            <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-neutral-100 dark:bg-dark-elevated">
                <Ionicons name={icon} size={18} color="#667085" />
            </View>
            <Text className="flex-1 font-sans text-sm leading-5 text-neutral-600 dark:text-dark-text-muted">
                {text}
            </Text>
        </View>
    );
}
