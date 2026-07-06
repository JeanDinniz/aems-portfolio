/**
 * CAM-04 / CAM-05 — PhotoCapture: componente reutilizável de captura de fotos.
 *
 * Orquestra: capturar/escolher → comprimir (SERIAL) → ENFILEIRAR na fila offline
 * persistente (`uploadQueue`), mantendo um array de `Photo` com estado por foto
 * (comprimindo / na fila / enviando % / enviado / erro com retry manual).
 *
 * Mudança do Sprint 3 (CAM-05): o upload direto foi trocado pelo enfileiramento
 * na `uploadQueue`. O componente assina as atualizações de cada item da fila e
 * reflete o estado em `value`/`onChange`. A fila sobrevive a fechar/reabrir o app
 * e à perda de rede (retry com backoff + reprocesso em foreground/reconexão).
 *
 * A API de props é mantida (`value`/`onChange`/`maxPhotos`/`minPhotos`/`label`),
 * adicionando apenas `osDraftId` (opcional) para vincular as fotos a um rascunho
 * de O.S. — usado pela tela de Criar O.S. para descobrir quando todas têm `url`.
 *
 * UI: grid de miniaturas (preview via expo-image), botão "adicionar" que abre um
 * Sheet (Câmera ou Galeria), remover, retry em erro. Permissão negada → Alert com
 * atalho para os Ajustes (`Linking.openSettings()`).
 */
import { useCallback, useEffect, useRef } from 'react';
import {
    ActivityIndicator,
    Alert,
    InteractionManager,
    Linking,
    Pressable,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/Button';
import { Sheet, type SheetRef } from '@/components/ui/Sheet';
import {
    captureFromCamera,
    pickFromLibrary,
    CaptureCancelled,
    PermissionDeniedError,
} from '@/services/camera/capturePhoto';
import { compressPhoto } from '@/services/camera/compressPhoto';
import {
    enqueue as enqueueUpload,
    retry as retryUpload,
    remove as removeFromQueue,
    subscribeItem,
    type QueueItem,
} from '@/services/upload/uploadQueue';
import type { LocalPhotoAsset, Photo } from '@/types/photo.types';

export interface PhotoCaptureProps {
    /** Lista controlada de fotos. */
    value: Photo[];
    /** Notifica mudanças (adição/remoção/progresso/erro). */
    onChange: (photos: Photo[]) => void;
    /** Máximo de fotos. Default 10. */
    maxPhotos?: number;
    /** Mínimo de fotos (usado só para o hint de UI). Default 1. */
    minPhotos?: number;
    /** Rótulo acima do grid. */
    label?: string;
    /**
     * Vincula as fotos enfileiradas a um rascunho de O.S. local. A tela de Criar
     * O.S. usa o mesmo id para consultar `isDraftComplete`/`getDraftUrls`.
     */
    osDraftId?: string;
}

let photoSeq = 0;
function makePhotoId(): string {
    photoSeq += 1;
    return `photo_${Date.now()}_${photoSeq}`;
}

/** Aplica o estado de um item da fila sobre a `Photo` correspondente. */
function queueItemToPhotoPatch(item: QueueItem): Partial<Photo> {
    return {
        uploaded: item.status === 'uploaded',
        uploadProgress: item.progress,
        url: item.url,
        error: item.status === 'error' ? item.error : undefined,
    };
}

export function PhotoCapture({
    value,
    onChange,
    maxPhotos = 10,
    minPhotos = 1,
    label,
    osDraftId,
}: PhotoCaptureProps) {
    const sheetRef = useRef<SheetRef>(null);

    // Mantém o `onChange`/`value` mais recentes acessíveis dentro das closures de
    // assinatura da fila (que vivem além do render que as criou).
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const valueRef = useRef(value);
    valueRef.current = value;

    /**
     * Atualização funcional baseada no `value` ATUAL (passado como argumento),
     * evitando closures obsoletas durante o pipeline assíncrono. O chamador é a
     * fonte da verdade; aqui derivamos o próximo array e propagamos via onChange.
     */
    const patchPhoto = useCallback(
        (current: Photo[], id: string, patch: Partial<Photo>): Photo[] =>
            current.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        []
    );

    /**
     * Propaga um novo array via onChange E sincroniza `valueRef` no MESMO tick.
     * Sem isso, callbacks assíncronos encadeados (compressão → fila) podem ler um
     * `valueRef` ainda defasado (o re-render do pai não commitou) e gerar um array
     * sem a foto recém-adicionada — zerando o estado. O pai continua dono da
     * verdade; aqui só evitamos a janela de leitura obsoleta.
     */
    const commit = useCallback((next: Photo[]) => {
        valueRef.current = next;
        onChangeRef.current(next);
    }, []);

    /** Aplica um patch a uma foto sobre o `valueRef` atual e faz commit. */
    const commitPatch = useCallback(
        (id: string, patch: Partial<Photo>) => {
            commit(patchPhoto(valueRef.current, id, patch));
        },
        [commit, patchPhoto]
    );

    // Assinaturas ativas da fila, por id de foto (para cleanup).
    const subsRef = useRef(new Map<string, () => void>());

    /** Assina as atualizações da fila para uma foto e reflete em `value`. */
    const watchQueueItem = useCallback(
        (photoId: string) => {
            if (subsRef.current.has(photoId)) return;
            const unsub = subscribeItem(photoId, (item) => {
                if (!item) return;
                commitPatch(photoId, queueItemToPhotoPatch(item));
            });
            subsRef.current.set(photoId, unsub);
        },
        [commitPatch]
    );

    // Re-assina fotos já presentes (ex.: rascunho restaurado) e remove
    // assinaturas órfãs quando a foto sai do array.
    useEffect(() => {
        const present = new Set(value.map((p) => p.id));
        for (const photo of value) {
            // Só vale assinar fotos que já chegaram à fila (têm comprimido) ou que
            // já trazem url (rascunho restaurado). Fotos ainda comprimindo são
            // assinadas ao fim do pipeline.
            if (photo.compressed || photo.url) watchQueueItem(photo.id);
        }
        for (const [id, unsub] of subsRef.current) {
            if (!present.has(id)) {
                unsub();
                subsRef.current.delete(id);
            }
        }
    }, [value, watchQueueItem]);

    // Cleanup geral no unmount.
    const subsAtUnmount = subsRef.current;
    useEffect(() => {
        return () => {
            for (const unsub of subsAtUnmount.values()) unsub();
            subsAtUnmount.clear();
        };
    }, [subsAtUnmount]);

    // Pipeline de UMA foto: comprimir → enfileirar na fila offline.
    const runPipeline = useCallback(
        async (photoId: string, asset: LocalPhotoAsset) => {
            // 1) Compressão (serial garantida pelo próprio compressPhoto).
            let compressed: LocalPhotoAsset;
            try {
                compressed = await compressPhoto(asset);
            } catch (error) {
                commitPatch(photoId, {
                    error: error instanceof Error ? error.message : 'Falha ao comprimir.',
                });
                return;
            }

            // Mostra a miniatura comprimida e libera o asset original.
            commitPatch(photoId, {
                asset: undefined,
                compressed,
                preview: compressed.uri,
                error: undefined,
                uploadProgress: 0,
            });

            // 2) Enfileira na fila offline persistente (usa o id da foto como id
            //    do item — casa 1:1 com a UI). A fila copia o arquivo, persiste e
            //    dispara o upload serial com retry/backoff.
            watchQueueItem(photoId);
            try {
                await enqueueUpload(compressed, { id: photoId, osDraftId });
            } catch (error) {
                commitPatch(photoId, {
                    error: error instanceof Error ? error.message : 'Falha ao enfileirar.',
                });
            }
        },
        [commitPatch, watchQueueItem, osDraftId]
    );

    const handleAdd = useCallback(
        async (source: 'camera' | 'library') => {
            if (valueRef.current.length >= maxPhotos) return;

            let asset: LocalPhotoAsset;
            try {
                asset = source === 'camera' ? await captureFromCamera() : await pickFromLibrary();
            } catch (error) {
                if (error instanceof CaptureCancelled) return; // silencioso
                if (error instanceof PermissionDeniedError) {
                    Alert.alert(
                        'Permissão necessária',
                        `${error.message} Você pode habilitar nas configurações do aparelho.`,
                        error.canAskAgain
                            ? [{ text: 'OK' }]
                            : [
                                  { text: 'Cancelar', style: 'cancel' },
                                  { text: 'Abrir Ajustes', onPress: () => Linking.openSettings() },
                              ]
                    );
                    return;
                }
                Alert.alert('Erro', 'Não foi possível obter a foto.');
                return;
            }

            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const id = makePhotoId();
            const photo: Photo = {
                id,
                asset,
                preview: asset.uri, // preview da original até a compressão terminar
                uploaded: false,
                uploadProgress: 0,
            };
            commit([...valueRef.current, photo]);
            void runPipeline(id, asset);
        },
        [maxPhotos, runPipeline, commit]
    );

    const promptSource = useCallback(() => {
        sheetRef.current?.present();
    }, []);

    // Origem escolhida no Sheet, aguardando o fechamento COMPLETO do bottom-sheet
    // antes de lançar o picker nativo. Ver `handleSheetDismiss`.
    const pendingSourceRef = useRef<'camera' | 'library' | null>(null);

    const pickSource = useCallback((source: 'camera' | 'library') => {
        // NÃO lança o picker aqui: no iOS, apresentar o UIImagePicker/PHPicker
        // enquanto o BottomSheetModal ainda anima o fechamento faz o picker ser
        // apresentado ATRÁS do backdrop do sheet — tela preta com o X inacessível.
        // Guardamos a origem e disparamos a captura só no `onDismiss` do Sheet,
        // que só roda após a animação de fechamento terminar.
        pendingSourceRef.current = source;
        sheetRef.current?.dismiss();
    }, []);

    /**
     * Chamado pelo Sheet APÓS o fechamento concluir. Se havia uma origem pendente,
     * lança o picker agora — com a árvore de modais já limpa (sem o backdrop por
     * cima). Cobre também o caso de o usuário fechar o sheet sem escolher (no-op).
     */
    const handleSheetDismiss = useCallback(() => {
        const source = pendingSourceRef.current;
        pendingSourceRef.current = null;
        if (!source) return;
        // Adia para depois das interações/animações pendentes garantindo que o
        // backdrop do sheet já saiu da janela antes de o iOS apresentar o picker.
        InteractionManager.runAfterInteractions(() => {
            void handleAdd(source);
        });
    }, [handleAdd]);

    const handleRemove = useCallback(
        (id: string) => {
            // Cancela a assinatura e remove o item (e o arquivo) da fila.
            const unsub = subsRef.current.get(id);
            if (unsub) {
                unsub();
                subsRef.current.delete(id);
            }
            void removeFromQueue(id);
            commit(valueRef.current.filter((p) => p.id !== id));
        },
        [commit]
    );

    const handleRetry = useCallback(
        (photo: Photo) => {
            commitPatch(photo.id, { error: undefined, uploadProgress: 0 });

            if (photo.compressed) {
                // Já está na fila: garante a assinatura e dispara o retry manual.
                watchQueueItem(photo.id);
                void retryUpload(photo.id);
            } else if (photo.asset) {
                // Falhou ainda na compressão: refaz o pipeline desde o asset.
                void runPipeline(photo.id, photo.asset);
            }
        },
        [commitPatch, watchQueueItem, runPipeline]
    );

    const canAddMore = value.length < maxPhotos;

    return (
        <View className="gap-2">
            {label ? (
                // Cabeçalho de altura fixa (rótulo + contador em linha própria) para que
                // slots lado a lado fiquem alinhados mesmo com rótulos de tamanhos
                // diferentes (ex.: "Foto de avaria (opcional)" quebra em 2 linhas).
                <View className="min-h-[38px]">
                    <Text
                        className="font-sans-bold text-sm text-neutral-700 dark:text-dark-text"
                        numberOfLines={2}
                    >
                        {label}
                    </Text>
                    <Text className="font-sans text-xs text-neutral-400">
                        {`${value.length}/${maxPhotos}`}
                        {minPhotos > 0 ? ` (mín. ${minPhotos})` : ''}
                    </Text>
                </View>
            ) : null}

            <View className="flex-row flex-wrap gap-2">
                {value.map((photo) => (
                    <PhotoThumb
                        key={photo.id}
                        photo={photo}
                        onRemove={() => handleRemove(photo.id)}
                        onRetry={() => handleRetry(photo)}
                    />
                ))}

                {canAddMore ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Adicionar foto"
                        onPress={promptSource}
                        className="h-24 w-24 items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 active:opacity-70 dark:border-dark-border"
                    >
                        <Ionicons name="add" size={28} color="#98A2B3" />
                        <Text className="mt-0.5 font-sans-medium text-xs text-neutral-400">
                            Adicionar
                        </Text>
                    </Pressable>
                ) : null}
            </View>

            {value.length === 0 && !label ? (
                <Button
                    title="Adicionar foto"
                    icon="camera-outline"
                    variant="secondary"
                    onPress={promptSource}
                />
            ) : null}

            {/* Sheet de origem da foto (substitui o Alert) */}
            <Sheet ref={sheetRef} title="Adicionar foto" onDismiss={handleSheetDismiss}>
                <View className="gap-2 pb-1">
                    <SourceRow
                        icon="camera-outline"
                        label="Tirar foto"
                        description="Usar a câmera do aparelho"
                        onPress={() => pickSource('camera')}
                    />
                    <SourceRow
                        icon="images-outline"
                        label="Escolher da galeria"
                        description="Selecionar uma foto existente"
                        onPress={() => pickSource('library')}
                    />
                </View>
            </Sheet>
        </View>
    );
}

interface SourceRowProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    description: string;
    onPress: () => void;
}

/** Linha de opção dentro do Sheet de origem (área de toque ≥ 44pt). */
function SourceRow({ icon, label, description, onPress }: SourceRowProps) {
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

interface PhotoThumbProps {
    photo: Photo;
    onRemove: () => void;
    onRetry: () => void;
}

/** Miniatura individual com overlay de estado (comprimindo/enviando/erro/ok). */
function PhotoThumb({ photo, onRemove, onRetry }: PhotoThumbProps) {
    const isCompressing = !photo.compressed && !photo.error;
    const isUploading = !!photo.compressed && !photo.uploaded && !photo.error;
    const hasError = !!photo.error;

    const a11yState = hasError
        ? 'erro no envio'
        : photo.uploaded
          ? 'enviada'
          : isUploading
            ? `enviando ${photo.uploadProgress}%`
            : 'comprimindo';

    return (
        <View
            accessibilityLabel={`Foto ${a11yState}`}
            className="h-24 w-24 overflow-hidden rounded-xl bg-neutral-100 dark:bg-dark-elevated"
        >
            <Image
                source={{ uri: photo.preview }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={100}
            />

            {/* Botão remover (área de toque ampliada via hitSlop) */}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remover foto"
                hitSlop={10}
                onPress={onRemove}
                className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-black/60 active:opacity-70"
            >
                <Ionicons name="close" size={16} color="#FFFFFF" />
            </Pressable>

            {/* Overlay: comprimindo */}
            {isCompressing ? (
                <View className="absolute inset-0 items-center justify-center bg-black/45">
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text className="mt-1 font-sans-semibold text-[10px] text-white">
                        Comprimindo
                    </Text>
                </View>
            ) : null}

            {/* Overlay: enviando — rótulo + barra de progresso */}
            {isUploading ? (
                <View className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 pb-1.5 pt-1">
                    <Text className="text-center font-sans-bold text-[10px] text-white">
                        {`Enviando ${photo.uploadProgress}%`}
                    </Text>
                    <View className="mt-1 h-1 overflow-hidden rounded-full bg-white/30">
                        <View
                            style={{ width: `${Math.max(0, Math.min(100, photo.uploadProgress))}%` }}
                            className="h-full rounded-full bg-brand"
                        />
                    </View>
                </View>
            ) : null}

            {/* Selo de enviado */}
            {photo.uploaded ? (
                <View className="absolute bottom-1 left-1 h-5 w-5 items-center justify-center rounded-full bg-success">
                    <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                </View>
            ) : null}

            {/* Overlay: erro com retry manual */}
            {hasError ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tentar enviar novamente"
                    onPress={onRetry}
                    className="absolute inset-0 items-center justify-center bg-error/75 active:opacity-80"
                >
                    <Ionicons name="refresh" size={22} color="#FFFFFF" />
                    <Text className="mt-1 px-1 text-center font-sans-bold text-[10px] text-white">
                        Tentar de novo
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}
