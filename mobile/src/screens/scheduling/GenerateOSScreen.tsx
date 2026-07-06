import { useCallback, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { PhotoCapture } from '@/components/features/PhotoCapture';
import { useGenerateOS } from '@/hooks/useScheduling';
import { getApiErrorMessage } from '@/lib/api-error';
import { pruneUploaded } from '@/services/upload/uploadQueue';
import type { Photo } from '@/types/photo.types';
import type { SchedulingStackScreenProps } from '@/navigation/types';

/**
 * AGD-05 — GenerateOSScreen: gera a O.S. a partir de um agendamento.
 *
 * Espelha o GenerateOSModal do web (doc 03): exige ≥1 foto do veículo + campo
 * de observações opcional. As fotos passam pelo MESMO pipeline da criação de
 * O.S. (PhotoCapture → fila offline persistente); o submit só prossegue quando
 * todas têm `url` (estado "Enviando fotos…" enquanto pendente).
 *
 * Ao concluir, exibe o `order_number` retornado (Toast) e abre o detalhe da O.S.
 * recém-gerada (cross-stack, aba O.S.). Poda os ids consumidos da fila.
 */

let generateDraftSeq = 0;
function makeDraftId(): string {
    generateDraftSeq += 1;
    return `genos_${Date.now()}_${generateDraftSeq}`;
}

export function GenerateOSScreen({
    route,
    navigation,
}: SchedulingStackScreenProps<'GenerateOS'>) {
    const { id } = route.params;
    const toast = useToast();
    const generateOS = useGenerateOS();

    const [osDraftId] = useState(() => makeDraftId());
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [notes, setNotes] = useState('');

    // ─── Gates de submit ──────────────────────────────────────────────────────
    const photosUploading = photos.some((p) => !p.url && !p.error);
    const hasMinPhoto = photos.length >= 1;
    const allPhotosUploaded = photos.length > 0 && photos.every((p) => !!p.url);

    const isBusy = generateOS.isPending;
    const canSubmit = hasMinPhoto && allPhotosUploaded && !photosUploading && !isBusy;

    const submit = useCallback(async () => {
        Keyboard.dismiss();

        if (!hasMinPhoto) {
            toast.error('Adicione ao menos 1 foto do veículo.');
            return;
        }
        if (photosUploading || !allPhotosUploaded) {
            toast.show('Aguarde o envio das fotos terminar.', { variant: 'warning' });
            return;
        }

        const photoUrls = photos.map((p) => p.url as string);
        const consumedIds = photos.filter((p) => !!p.url).map((p) => p.id);

        try {
            const result = await generateOS.mutateAsync({
                id,
                payload: {
                    photos: photoUrls,
                    notes: notes.trim() || undefined,
                },
            });
            void pruneUploaded(consumedIds);
            toast.success(`O.S. ${result.order_number} gerada com sucesso!`);
            // Volta para a LISTA de Agendamentos (hub operacional): o card do
            // agendamento passa a "Em execução" (o hook invalida ['scheduling']).
            // `popToTop` desempilha esta tela e o detalhe — sem isso, ao voltar à
            // aba Agendamentos ela reabriria neste Gerar O.S. e um novo toque daria
            // "agendamento já possui O.S.". O fluxo segue no detalhe (Finalizar).
            navigation.popToTop();
        } catch (err) {
            toast.error(getApiErrorMessage(err as Error, 'Não foi possível gerar a O.S.'));
        }
    }, [
        hasMinPhoto,
        photosUploading,
        allPhotosUploaded,
        photos,
        generateOS,
        id,
        notes,
        toast,
        navigation,
    ]);

    const submitLabel = photosUploading
        ? 'Enviando fotos...'
        : isBusy
          ? 'Gerando O.S...'
          : 'Gerar O.S.';

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Gerar O.S." onBack={() => navigation.goBack()} />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="interactive"
            >
                {/* ─── Foto do veículo (≥1) ──────────────────────────────── */}
                <View className="mb-5">
                    <PhotoCapture
                        label="Foto do veículo"
                        value={photos}
                        onChange={setPhotos}
                        minPhotos={1}
                        maxPhotos={10}
                        osDraftId={osDraftId}
                    />
                    {!hasMinPhoto ? (
                        <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            Pelo menos 1 foto do veículo é obrigatória.
                        </Text>
                    ) : null}
                </View>

                {/* ─── Observações (opcional) ────────────────────────────── */}
                <TextField
                    label="Observações"
                    placeholder="Notas adicionais..."
                    multiline
                    numberOfLines={3}
                    style={{ minHeight: 80, textAlignVertical: 'top' }}
                    value={notes}
                    onChangeText={setNotes}
                    editable={!isBusy}
                />

                {/* ─── Ação ──────────────────────────────────────────────── */}
                <View className="mt-2">
                    <Button
                        title={submitLabel}
                        icon="add-circle-outline"
                        loading={isBusy || photosUploading}
                        disabled={!canSubmit}
                        onPress={submit}
                    />
                </View>
            </ScrollView>
        </View>
    );
}
