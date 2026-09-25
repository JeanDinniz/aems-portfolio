/**
 * VID-02 — VideoAttach: componente de anexo de vídeo (opcional) na criação de O.S.
 *
 * Fluxo: escolher fonte (câmera/galeria) → validar tamanho (≤ 50 MB) →
 * fazer upload para POST /upload/video → exibir preview (thumbnail + ícone play)
 * com barra de progresso e opção de remover.
 *
 * O vídeo é OPCIONAL e único por O.S. — o componente é simples (sem fila offline,
 * sem compressão nativa): captura, valida e faz upload direto. A UI bloqueia o
 * submit enquanto o upload estiver em andamento (uploadingVideo prop).
 *
 * Permissão negada → Alert com atalho para Ajustes (espelha PhotoCapture).
 */
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    InteractionManager,
    Linking,
    Pressable,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';

import { useConfirm } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import {
    suppressAppLock,
    releaseAppLock,
} from '@/services/biometrics';
import {
    uploadVideo,
    validateVideoSize,
    UploadVideoError,
    type LocalVideoAsset,
} from '@/services/upload/uploadVideo';

const MAX_VIDEO_DURATION_S = 120; // 2 min — mantém o arquivo dentro de ~50 MB

/** Estado interno do vídeo anexado. */
export interface VideoState {
    /** URI local temporário (do picker). */
    localUri: string;
    /** URL no servidor após upload bem-sucedido. */
    url?: string;
    /** Progresso do upload 0-100. */
    progress: number;
    /** Mensagem de erro (se o upload falhou). */
    error?: string;
    /** `true` quando o upload está em andamento. */
    uploading: boolean;
}

export interface VideoAttachProps {
    /** URL do vídeo já enviado (controla externamente). `null` = sem vídeo. */
    value: string | null;
    /**
     * Chamado quando o vídeo é removido ou o upload conclui com sucesso.
     * `null` → vídeo removido; `url` → upload concluído.
     */
    onChange: (url: string | null) => void;
    /** Notifica se o upload está em andamento (pai usa para travar o submit). */
    onUploadingChange?: (uploading: boolean) => void;
    /** `true` quando o formulário pai está ocupado (desabilita interações). */
    disabled?: boolean;
}

function makeVideoAsset(asset: ImagePicker.ImagePickerAsset): LocalVideoAsset {
    return {
        uri: asset.uri,
        name: asset.fileName ?? 'video.mp4',
        mime: asset.mimeType ?? 'video/mp4',
        fileSize: asset.fileSize ?? undefined,
    };
}

export function VideoAttach({ value, onChange, onUploadingChange, disabled }: VideoAttachProps) {
    const { confirm, alert } = useConfirm();
    const sheetRef = useRef<SheetRef>(null);
    const [videoState, setVideoState] = useState<VideoState | null>(null);

    // Origem pendente (aguarda o sheet fechar para lançar o picker nativo)
    const pendingSourceRef = useRef<'camera' | 'library' | null>(null);

    const notifyUploading = useCallback(
        (uploading: boolean) => {
            onUploadingChange?.(uploading);
        },
        [onUploadingChange]
    );

    const runUpload = useCallback(
        async (asset: LocalVideoAsset) => {
            // Valida tamanho antes de iniciar
            try {
                validateVideoSize(asset);
            } catch (err) {
                const msg = err instanceof UploadVideoError ? err.message : 'Vídeo inválido.';
                await alert({ title: 'Vídeo muito grande', message: msg });
                return;
            }

            setVideoState({
                localUri: asset.uri,
                progress: 0,
                uploading: true,
            });
            notifyUploading(true);

            try {
                const url = await uploadVideo(asset, (percent) => {
                    setVideoState((prev) => (prev ? { ...prev, progress: percent } : prev));
                });
                setVideoState((prev) =>
                    prev ? { ...prev, url, progress: 100, uploading: false, error: undefined } : prev
                );
                notifyUploading(false);
                onChange(url);
            } catch (err) {
                const msg = err instanceof UploadVideoError ? err.message : 'Falha ao enviar o vídeo.';
                setVideoState((prev) =>
                    prev ? { ...prev, error: msg, uploading: false } : prev
                );
                notifyUploading(false);
            }
        },
        [onChange, notifyUploading, alert]
    );

    const handlePickSource = useCallback(
        async (source: 'camera' | 'library') => {
            suppressAppLock();
            let result: ImagePicker.ImagePickerResult;
            try {
                if (source === 'camera') {
                    const perm = await ImagePicker.requestCameraPermissionsAsync();
                    if (!perm.granted) {
                        Alert.alert(
                            'Permissão necessária',
                            'Permissão de câmera negada. Você pode habilitar nas configurações do aparelho.',
                            perm.canAskAgain
                                ? [{ text: 'OK' }]
                                : [
                                      { text: 'Cancelar', style: 'cancel' },
                                      {
                                          text: 'Abrir Ajustes',
                                          onPress: () => void Linking.openSettings(),
                                      },
                                  ]
                        );
                        return;
                    }
                    result = await ImagePicker.launchCameraAsync({
                        mediaTypes: ['videos'],
                        videoMaxDuration: MAX_VIDEO_DURATION_S,
                        quality: ImagePicker.UIImagePickerControllerQualityType.Medium,
                        allowsMultipleSelection: false,
                    });
                } else {
                    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
                    if (!perm.granted) {
                        Alert.alert(
                            'Permissão necessária',
                            'Permissão de acesso à galeria negada. Você pode habilitar nas configurações do aparelho.',
                            perm.canAskAgain
                                ? [{ text: 'OK' }]
                                : [
                                      { text: 'Cancelar', style: 'cancel' },
                                      {
                                          text: 'Abrir Ajustes',
                                          onPress: () => void Linking.openSettings(),
                                      },
                                  ]
                        );
                        return;
                    }
                    result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['videos'],
                        videoMaxDuration: MAX_VIDEO_DURATION_S,
                        quality: ImagePicker.UIImagePickerControllerQualityType.Medium,
                        allowsMultipleSelection: false,
                    });
                }
            } finally {
                releaseAppLock();
            }

            if (result.canceled || !result.assets[0]) return;

            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await runUpload(makeVideoAsset(result.assets[0]));
        },
        [runUpload]
    );

    const handleSheetDismiss = useCallback(() => {
        const source = pendingSourceRef.current;
        pendingSourceRef.current = null;
        if (!source) return;
        InteractionManager.runAfterInteractions(() => {
            void handlePickSource(source);
        });
    }, [handlePickSource]);

    const pickSource = useCallback((source: 'camera' | 'library') => {
        pendingSourceRef.current = source;
        sheetRef.current?.dismiss();
    }, []);

    const handleRemove = useCallback(async () => {
        const ok = await confirm({
            title: 'Remover vídeo?',
            message: 'O vídeo anexado será removido da O.S.',
            confirmLabel: 'Remover',
            destructive: true,
        });
        if (ok) {
            setVideoState(null);
            onChange(null);
        }
    }, [confirm, onChange]);

    const handleRetry = useCallback(() => {
        if (!videoState?.localUri) return;
        const asset: LocalVideoAsset = {
            uri: videoState.localUri,
            mime: 'video/mp4',
            name: 'video.mp4',
        };
        void runUpload(asset);
    }, [videoState, runUpload]);

    // Há vídeo remoto (carregado de uma O.S. existente)
    const hasRemoteVideo = !!value && !videoState;
    const hasLocalVideo = !!videoState;
    const hasAnyVideo = hasRemoteVideo || hasLocalVideo;

    if (!hasAnyVideo) {
        return (
            <View className="gap-2">
                <View className="flex-row items-center gap-1.5">
                    <Text className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                        Vídeo
                    </Text>
                    <Text className="font-sans text-xs text-neutral-400">(opcional)</Text>
                </View>
                <Button
                    title="Adicionar vídeo"
                    icon="videocam-outline"
                    variant="secondary"
                    disabled={disabled}
                    onPress={() => sheetRef.current?.present()}
                />
                <Sheet ref={sheetRef} title="Adicionar vídeo" onDismiss={handleSheetDismiss}>
                    <View className="gap-2 pb-1">
                        <VideoSourceRow
                            icon="videocam-outline"
                            label="Gravar vídeo"
                            description="Usar a câmera do aparelho"
                            onPress={() => pickSource('camera')}
                        />
                        <VideoSourceRow
                            icon="film-outline"
                            label="Escolher da galeria"
                            description="Selecionar um vídeo existente"
                            onPress={() => pickSource('library')}
                        />
                    </View>
                </Sheet>
            </View>
        );
    }

    // Vídeo remoto (preview simples)
    if (hasRemoteVideo) {
        return (
            <VideoPreviewCard
                label="Vídeo anexado"
                progress={100}
                uploaded
                onRemove={disabled ? undefined : handleRemove}
            />
        );
    }

    // Vídeo local (em andamento / enviado / erro)
    const { progress, uploading, error, url: localUrl } = videoState!;
    return (
        <VideoPreviewCard
            label={
                error
                    ? 'Erro ao enviar vídeo'
                    : uploading
                      ? `Enviando vídeo ${progress}%`
                      : localUrl
                        ? 'Vídeo anexado'
                        : 'Vídeo pronto'
            }
            progress={progress}
            uploading={uploading}
            uploaded={!!localUrl && !uploading && !error}
            error={error}
            onRemove={disabled || uploading ? undefined : handleRemove}
            onRetry={error ? handleRetry : undefined}
        />
    );
}

// ─── Subcomponentes ───────────────────────────────────────────────────────────

interface VideoSourceRowProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    description: string;
    onPress: () => void;
}

function VideoSourceRow({ icon, label, description, onPress }: VideoSourceRowProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={description}
            onPress={onPress}
            className="min-h-[56px] flex-row items-center gap-3 rounded-xl bg-neutral-50 px-3 py-3 active:opacity-70 dark:bg-dark-elevated"
        >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-50 dark:bg-dark-surface">
                <Ionicons name={icon} size={20} color="#D47F00" />
            </View>
            <View className="flex-1">
                <Text className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text">
                    {label}
                </Text>
                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {description}
                </Text>
            </View>
        </Pressable>
    );
}

interface VideoPreviewCardProps {
    label: string;
    progress: number;
    uploading?: boolean;
    uploaded?: boolean;
    error?: string;
    onRemove?: () => void;
    onRetry?: () => void;
}

/**
 * Card de preview do vídeo: ícone de play centralizado, rótulo de estado,
 * barra de progresso (durante upload), botão remover e opção de retry.
 */
function VideoPreviewCard({
    label,
    progress,
    uploading,
    uploaded,
    error,
    onRemove,
    onRetry,
}: VideoPreviewCardProps) {
    return (
        <View className="gap-2">
            <View className="flex-row items-center gap-1.5">
                <Text className="font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                    Vídeo
                </Text>
                <Text className="font-sans text-xs text-neutral-400">(opcional)</Text>
            </View>

            <View
                accessibilityLabel={`Vídeo: ${label}`}
                className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-dark-border dark:bg-dark-elevated"
            >
                {/* Área do player (thumbnail simulada — sem decodificação de frame) */}
                <View className="h-28 items-center justify-center bg-neutral-900">
                    {uploading ? (
                        <ActivityIndicator color="#FFFFFF" size="large" />
                    ) : error ? (
                        <Ionicons name="alert-circle-outline" size={40} color="#F04438" />
                    ) : (
                        <View className="h-14 w-14 items-center justify-center rounded-full bg-white/20">
                            <Ionicons name="play" size={32} color="#FFFFFF" />
                        </View>
                    )}
                </View>

                {/* Barra de progresso (visível durante upload) */}
                {uploading ? (
                    <View className="bg-neutral-800 px-3 pb-2 pt-1.5">
                        <Text className="mb-1 text-center font-sans-bold text-[11px] text-white">
                            {`Enviando ${progress}%`}
                        </Text>
                        <View className="h-1.5 overflow-hidden rounded-full bg-white/20">
                            <View
                                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                                className="h-full rounded-full bg-brand"
                            />
                        </View>
                    </View>
                ) : null}

                {/* Rodapé: rótulo + botões de ação */}
                <View className="flex-row items-center justify-between px-3 py-2">
                    <View className="flex-row items-center gap-1.5 flex-1">
                        {uploaded ? (
                            <Ionicons name="checkmark-circle" size={16} color="#12B76A" />
                        ) : error ? (
                            <Ionicons name="alert-circle" size={16} color="#F04438" />
                        ) : null}
                        <Text
                            className={[
                                'flex-1 font-sans text-xs',
                                error
                                    ? 'text-error dark:text-error-dark'
                                    : 'text-neutral-600 dark:text-dark-text-muted',
                            ].join(' ')}
                            numberOfLines={1}
                        >
                            {label}
                        </Text>
                    </View>

                    <View className="flex-row items-center gap-2">
                        {onRetry ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Tentar enviar novamente"
                                hitSlop={8}
                                onPress={onRetry}
                                className="flex-row items-center gap-1 active:opacity-70"
                            >
                                <Ionicons name="refresh" size={16} color="#D47F00" />
                                <Text className="font-sans-medium text-xs text-brand-black dark:text-brand">
                                    Tentar de novo
                                </Text>
                            </Pressable>
                        ) : null}
                        {onRemove ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Remover vídeo"
                                hitSlop={8}
                                onPress={onRemove}
                                className="active:opacity-70"
                            >
                                <Ionicons name="trash-outline" size={16} color="#F04438" />
                            </Pressable>
                        ) : null}
                    </View>
                </View>
            </View>
        </View>
    );
}
