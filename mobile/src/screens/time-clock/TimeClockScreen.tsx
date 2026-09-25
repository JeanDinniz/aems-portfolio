import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { PunchReceipt } from '@/components/time-clock/PunchReceipt';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useTimeClockMe, usePunch, usePunchQueue } from '@/hooks/useTimeClock';
import {
    captureFromCamera,
    CaptureCancelled,
    PermissionDeniedError,
} from '@/services/camera/capturePhoto';
import { compressPhoto } from '@/services/camera/compressPhoto';
import { generateFaceEmbedding } from '@/services/face/faceEmbedding';
import { uploadPhoto } from '@/services/upload/uploadPhoto';
import * as punchQueue from '@/services/time-clock/punchQueue';
import { getCurrentLocation, LocationError } from '@/services/location/getCurrentLocation';
import { getApiErrorMessage } from '@/lib/api-error';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';
import { mediaHeaders } from '@/lib/mediaSource';
import { formatClock, formatDateBR, formatTimeBR } from '@/utils/formatDate';
import type { LocalPhotoAsset } from '@/types/photo.types';
import type { PunchType, TimeClockReceipt, TimeClockRecord } from '@/types/time-clock.types';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * TimeClockScreen — Ponto Eletrônico (Portaria MTP 671/2021).
 *
 * A marcação NUNCA pode ser impedida por falta de rede. O fluxo captura a
 * batida por completo e, se houver conexão, envia na hora; se não, ENFILEIRA de
 * forma persistente (fila `punchQueue`) para sincronizar depois — sempre
 * preservando o `client_reported_at` (horário do relógio do aparelho no instante
 * da batida) como metadado. O horário OFICIAL continua sendo o do servidor.
 *
 * Fluxo da batida (uma única ação, com progresso por etapa):
 *   1. Localização (expo-location) — permissão + fix de GPS.
 *   2. Selfie frontal (câmera do aparelho, câmera dianteira).
 *   3. (Opcional) embedding facial se o funcionário tem rosto cadastrado.
 *   4. Comprime a foto (nativo, serial) e captura `client_reported_at`.
 *   5. Verifica a rede:
 *        - ONLINE  → upload da foto + `POST /punch` na hora.
 *        - OFFLINE → enfileira a batida inteira (envia no sync).
 *      Falha de rede no upload/punch também cai para a fila (não perde a batida).
 *
 * O botão alterna Entrada/Saída conforme `last_type`. Um indicador mostra quantas
 * batidas estão pendentes de envio; a fila drena ao abrir a tela, ao voltar do
 * background e ao reconectar (ver `usePunchQueue`).
 */

/** Próximo tipo de batida a partir da última do dia. */
function nextPunchType(lastType: PunchType | null): PunchType {
    return lastType === 'in' ? 'out' : 'in';
}

/** Etapas do progresso da batida (para o rótulo do botão / overlay). */
type PunchStep =
    | 'idle'
    | 'location'
    | 'camera'
    | 'face'
    | 'compress'
    | 'network'
    | 'upload'
    | 'punch';

const STEP_LABEL: Record<Exclude<PunchStep, 'idle'>, string> = {
    location: 'Obtendo localização...',
    camera: 'Abrindo a câmera...',
    face: 'Conferindo o rosto...',
    compress: 'Processando a foto...',
    network: 'Verificando conexão...',
    upload: 'Enviando a foto...',
    punch: 'Registrando o ponto...',
};

/** Erro transitório de rede — sinaliza que a batida deve cair para a fila offline. */
class NetworkError extends Error {}

/** `true` quando o erro é de conectividade (deve enfileirar, não descartar a batida). */
function isNetworkError(error: unknown): boolean {
    if (error instanceof NetworkError) return true;
    // AxiosError sem `response` = falha de rede/timeout (não chegou ao servidor).
    const err = error as { response?: unknown; code?: string; message?: string };
    if (err && typeof err === 'object' && 'response' in err && err.response == null) {
        return true;
    }
    const msg = (err?.message ?? '').toLowerCase();
    return msg.includes('network') || msg.includes('timeout');
}

export function TimeClockScreen({ navigation }: AppStackScreenProps<'TimeClock'>) {
    const toast = useToast();
    const { data, isLoading, isError, refetch, isRefetching } = useTimeClockMe();
    const punch = usePunch();
    // Assina a fila offline (drena ao montar/foreground/reconexão) e expõe pendências.
    const { pendingCount, items: pendingItems, retry: retryPending } = usePunchQueue();

    const [step, setStep] = useState<PunchStep>('idle');
    const isBusy = step !== 'idle' || punch.isPending;

    // Comprovante da ÚLTIMA batida: definitivo (online, com NSR real do servidor)
    // ou provisório (offline, mostrado até o sync gerar o comprovante oficial).
    const [receipt, setReceipt] = useState<{
        data: TimeClockReceipt;
        recordId: number;
    } | null>(null);
    const [provisionalAt, setProvisionalAt] = useState<string | null>(null);

    const runPunch = useCallback(async () => {
        if (!data || data.employee_id === null || isBusy) return;

        const type = nextPunchType(data.last_type);

        // Payload comum (usado tanto no envio online quanto no enfileiramento).
        let compressed: LocalPhotoAsset | undefined;
        let location: { latitude: number; longitude: number; accuracy_m?: number } | undefined;
        let faceEmbedding: number[] | undefined;
        let clientReportedAt = '';

        try {
            // 1) Localização.
            setStep('location');
            location = await getCurrentLocation();

            // 2) Selfie (câmera frontal).
            setStep('camera');
            const asset = await captureFromCamera('front');

            // 3) Reconhecimento facial (Fase 2a): gera o "código do rosto" a partir
            //    da selfie SE o funcionário tem rosto cadastrado. Ainda NÃO bloqueia
            //    a batida — se falhar (nenhum rosto detectado), segue sem conferir.
            if (data.face_enrolled) {
                setStep('face');
                try {
                    faceEmbedding = await generateFaceEmbedding(
                        asset.uri,
                        asset.width ?? 0,
                        asset.height ?? 0
                    );
                } catch {
                    faceEmbedding = undefined; // Fase 2a: não impede a batida
                }
            }

            // 4) Compressão nativa (serial) + horário do relógio do aparelho AGORA.
            setStep('compress');
            compressed = await compressPhoto(asset);
            // ISO 8601 COM FUSO (ex.: "2026-08-05T08:00:00-03:00") — o metadado que
            // preserva o instante real da batida, mesmo que o envio ocorra depois.
            clientReportedAt = toIsoWithOffset(new Date());
        } catch (error) {
            setStep('idle');
            // Cancelamento silencioso da câmera não é erro.
            if (error instanceof CaptureCancelled) return;
            if (error instanceof PermissionDeniedError) {
                toast.error(`${error.message} Habilite nas configurações do aparelho.`);
                return;
            }
            if (error instanceof LocationError) {
                toast.error(error.message);
                return;
            }
            toast.error(getApiErrorMessage(error as Error, 'Não foi possível preparar a batida.'));
            return;
        }

        // A batida já está capturada (foto + GPS + horário do aparelho). A partir
        // daqui, QUALQUER falta/queda de rede a envia para a fila — nunca descarta.
        const enqueuePending = async () => {
            await punchQueue.enqueue({
                type,
                asset: compressed!,
                latitude: location!.latitude,
                longitude: location!.longitude,
                accuracy_m: location!.accuracy_m,
                face_embedding: faceEmbedding,
                client_reported_at: clientReportedAt,
            });
            // Recibo PROVISÓRIO: sem NSR ainda (só sai após o sync). Substitui um
            // comprovante definitivo anterior na tela.
            setReceipt(null);
            setProvisionalAt(clientReportedAt);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            toast.show('Batida salva — será enviada quando houver conexão.', {
                variant: 'info',
            });
        };

        try {
            // 5) Rede: offline → enfileira; online → tenta enviar na hora.
            setStep('network');
            const net = await NetInfo.fetch();
            if (net.isConnected === false) {
                await enqueuePending();
                return;
            }

            setStep('upload');
            const photoUrl = await uploadPhoto(compressed);

            setStep('punch');
            const record = await punch.mutateAsync({
                type,
                photo_url: photoUrl,
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy_m: location.accuracy_m,
                face_embedding: faceEmbedding,
                client_reported_at: clientReportedAt,
                is_offline: false,
            });

            // Comprovante DEFINITIVO (NSR real do servidor). Substitui um recibo
            // provisório anterior. Só há comprovante quando o backend devolve `nsr`.
            setProvisionalAt(null);
            setReceipt(record.receipt ? { data: record.receipt, recordId: record.id } : null);

            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            if (record.is_within_radius === false) {
                toast.show('Batida registrada fora do raio da loja.', { variant: 'warning' });
            } else {
                toast.success(
                    type === 'in' ? 'Entrada registrada com sucesso!' : 'Saída registrada com sucesso!'
                );
            }

            // Feedback do reconhecimento facial (Fase 2a — só informativo, para
            // calibrarmos o limiar). Mostra a similaridade quando houve conferência.
            if (record.face_match_score != null) {
                const pct = Math.round(record.face_match_score * 100);
                toast.show(
                    `Conferência facial: ${pct}% de similaridade` +
                        (record.face_verified ? '' : ' (abaixo do limiar atual)'),
                    { variant: record.face_verified ? 'success' : 'warning' }
                );
            } else if (data.face_enrolled && !faceEmbedding) {
                toast.show('Não foi possível conferir o rosto nesta batida.', {
                    variant: 'warning',
                });
            }
        } catch (error) {
            // Falha de REDE no upload/punch: NÃO perde a batida — enfileira.
            if (isNetworkError(error)) {
                try {
                    await enqueuePending();
                } catch {
                    toast.error('Não foi possível salvar a batida offline. Tente novamente.');
                }
                return;
            }
            // Erro de aplicação do servidor (ex.: 422 sem vínculo): exibe o detail.
            toast.error(getApiErrorMessage(error as Error, 'Não foi possível bater o ponto.'));
        } finally {
            setStep('idle');
        }
    }, [data, isBusy, punch, toast]);

    // ─── Estados de carregamento / erro ──────────────────────────────────────
    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Ponto Eletrônico" onBack={() => navigation.goBack()} />
                <View className="gap-4 p-4">
                    <Skeleton className="h-28 w-full rounded-2xl" />
                    <Skeleton className="h-16 w-full rounded-2xl" />
                    <Skeleton className="h-40 w-full rounded-2xl" />
                </View>
            </View>
        );
    }

    if (isError || !data) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Ponto Eletrônico" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    // Usuário sem vínculo com funcionário.
    if (data.employee_id === null) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Ponto Eletrônico" onBack={() => navigation.goBack()} />
                <EmptyState
                    icon="person-remove-outline"
                    title="Sem vínculo de funcionário"
                    description="Seu usuário não está vinculado a um funcionário — fale com o administrador."
                />
            </View>
        );
    }

    const type = nextPunchType(data.last_type);
    const actionLabel = type === 'in' ? 'Bater Entrada' : 'Bater Saída';
    const busyLabel = step !== 'idle' ? STEP_LABEL[step] : 'Registrando o ponto...';

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Ponto Eletrônico" onBack={() => navigation.goBack()} />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                refreshControl={
                    <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
                }
            >
                {/* ─── Cabeçalho: funcionário / loja / horário ─────────────── */}
                <Card className="mb-4">
                    <Text className="font-display-bold text-lg text-neutral-900 dark:text-dark-text">
                        {data.employee_name ?? '—'}
                    </Text>
                    <View className="mt-2 gap-1.5">
                        <InfoRow
                            icon="storefront-outline"
                            label="Loja"
                            value={data.store_name ?? '—'}
                        />
                        <InfoRow
                            icon="time-outline"
                            label="Horário de trabalho"
                            value={
                                data.work_start_time || data.work_end_time
                                    ? `${formatClock(data.work_start_time)} – ${formatClock(data.work_end_time)}`
                                    : '—'
                            }
                        />
                    </View>
                </Card>

                {/* ─── Estado do dia + botão de batida ─────────────────────── */}
                <View className="mb-5 rounded-2xl bg-brand-black p-5">
                    <Text className="font-sans text-sm text-neutral-400">Estado atual</Text>
                    <View className="mt-1 flex-row items-center gap-2">
                        {data.last_type === 'in' ? (
                            <Badge label="Trabalhando" variant="success" icon="play-circle-outline" />
                        ) : data.last_type === 'out' ? (
                            <Badge label="Fora" variant="neutral" icon="stop-circle-outline" />
                        ) : (
                            <Badge
                                label="Sem batida hoje"
                                variant="warning"
                                icon="ellipse-outline"
                            />
                        )}
                    </View>

                    <View className="mt-4">
                        <Button
                            title={isBusy ? busyLabel : actionLabel}
                            icon={type === 'in' ? 'log-in-outline' : 'log-out-outline'}
                            loading={isBusy}
                            disabled={isBusy}
                            onPress={runPunch}
                        />
                    </View>
                    {isBusy ? (
                        <Text
                            accessibilityLiveRegion="polite"
                            className="mt-2 text-center font-sans text-xs text-neutral-400"
                        >
                            {busyLabel}
                        </Text>
                    ) : null}
                </View>

                {/* ─── Comprovante da última batida (definitivo/provisório) ── */}
                {receipt ? (
                    <View className="mb-5">
                        <PunchReceipt receipt={receipt.data} recordId={receipt.recordId} />
                    </View>
                ) : provisionalAt ? (
                    <View className="mb-5">
                        <PunchReceipt provisional collectedAt={provisionalAt} />
                    </View>
                ) : null}

                {/* ─── Batidas pendentes de envio (fila offline) ───────────── */}
                {pendingCount > 0 ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${pendingCount} ${
                            pendingCount === 1 ? 'batida pendente' : 'batidas pendentes'
                        } de envio. Toque para tentar enviar.`}
                        onPress={() => {
                            // Retry manual de todas as pendentes (útil se pararam em erro).
                            for (const it of pendingItems) void retryPending(it.id);
                            toast.show('Tentando enviar as batidas pendentes...', {
                                variant: 'info',
                            });
                        }}
                        className="mb-5 flex-row items-center gap-3 rounded-xl border border-warning-light bg-warning-light/40 p-3"
                    >
                        <Ionicons name="cloud-upload-outline" size={20} color="#F79009" />
                        <View className="flex-1">
                            <Text className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text">
                                {pendingCount}{' '}
                                {pendingCount === 1
                                    ? 'batida aguardando envio'
                                    : 'batidas aguardando envio'}
                            </Text>
                            <Text className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                Serão enviadas automaticamente ao reconectar. Toque para tentar
                                agora.
                            </Text>
                        </View>
                        <Ionicons name="refresh-outline" size={18} color="#98A2B3" />
                    </Pressable>
                ) : null}

                {/* ─── Meu Espelho (autoatendimento — consulta/exporta batidas) ─ */}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Abrir Meu Espelho de ponto"
                    onPress={() => navigation.navigate('MyTimeClockMirror')}
                    className="mb-5 flex-row items-center gap-3 rounded-xl border border-neutral-100 bg-white p-3 dark:border-dark-border-soft dark:bg-dark-surface"
                >
                    <View className="h-11 w-11 items-center justify-center rounded-full bg-brand/15">
                        <Ionicons name="document-text-outline" size={22} color="#F5B800" />
                    </View>
                    <View className="flex-1">
                        <Text className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text">
                            Meu Espelho
                        </Text>
                        <Text className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                            Consulte suas batidas (24h/mês) e exporte em PDF.
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
                </Pressable>

                {/* ─── Reconhecimento facial (cadastro do rosto) ───────────── */}
                {data.face_enrolled ? (
                    <View className="mb-5 flex-row items-center gap-2 rounded-xl border border-success-light bg-success-light/40 p-3">
                        <Ionicons name="checkmark-circle" size={20} color="#12B76A" />
                        <Text className="flex-1 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                            Rosto cadastrado
                        </Text>
                    </View>
                ) : (
                    <Card className="mb-5">
                        <View className="flex-row items-start gap-3">
                            <View className="h-11 w-11 items-center justify-center rounded-full bg-brand/15">
                                <Ionicons name="scan-outline" size={22} color="#F5B800" />
                            </View>
                            <View className="flex-1">
                                <Text className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text">
                                    Cadastre seu rosto
                                </Text>
                                <Text className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                                    Necessário para confirmar sua identidade nas batidas.
                                </Text>
                            </View>
                        </View>
                        <View className="mt-3">
                            <Button
                                title="Cadastrar rosto"
                                icon="camera-outline"
                                variant="secondary"
                                size="sm"
                                disabled={isBusy}
                                onPress={() => navigation.navigate('FaceEnroll')}
                            />
                        </View>
                    </Card>
                )}

                {/* ─── Batidas de hoje ─────────────────────────────────────── */}
                <SectionTitle title="Hoje" />
                {data.today.length === 0 ? (
                    <Text className="mb-6 font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                        Nenhuma batida registrada hoje.
                    </Text>
                ) : (
                    <View className="mb-6 gap-2">
                        {data.today.map((record) => (
                            <PunchRow key={record.id} record={record} showDate={false} />
                        ))}
                    </View>
                )}

                {/* ─── Últimos 7 dias ──────────────────────────────────────── */}
                <SectionTitle title="Últimos 7 dias" />
                {data.recent.length === 0 ? (
                    <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                        Sem batidas nos últimos dias.
                    </Text>
                ) : (
                    <View className="gap-2">
                        {data.recent.map((record) => (
                            <PunchRow key={record.id} record={record} showDate />
                        ))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

/**
 * ISO 8601 COM o offset do fuso local (ex.: "2026-08-05T08:00:00-03:00"), sem
 * libs externas. `Date.toISOString()` só devolve UTC ("...Z") — aqui montamos o
 * horário LOCAL do aparelho + o offset, que é o formato esperado pelo backend
 * para o `client_reported_at` (preserva o instante real da batida offline).
 */
function toIsoWithOffset(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const offsetMin = -d.getTimezoneOffset(); // getTimezoneOffset é invertido
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
}

interface InfoRowProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
    return (
        <View className="flex-row items-center gap-2">
            <Ionicons name={icon} size={16} color="#98A2B3" />
            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                {label}:
            </Text>
            <Text className="flex-1 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
                {value}
            </Text>
        </View>
    );
}

function SectionTitle({ title }: { title: string }) {
    return (
        <Text className="mb-2 font-sans-bold text-sm uppercase tracking-wide text-neutral-500 dark:text-dark-text-muted">
            {title}
        </Text>
    );
}

interface PunchRowProps {
    record: TimeClockRecord;
    showDate: boolean;
}

function PunchRow({ record, showDate }: PunchRowProps) {
    const isIn = record.type === 'in';
    const outOfRadius = record.is_within_radius === false;

    return (
        <View className="flex-row items-center gap-3 rounded-xl border border-neutral-100 bg-white p-3 dark:border-dark-border-soft dark:bg-dark-surface">
            <View
                className={`h-11 w-11 items-center justify-center rounded-full ${
                    isIn ? 'bg-success-light' : 'bg-neutral-100 dark:bg-dark-elevated'
                }`}
            >
                <Ionicons
                    name={isIn ? 'log-in-outline' : 'log-out-outline'}
                    size={20}
                    color={isIn ? '#12B76A' : '#667085'}
                />
            </View>

            <View className="flex-1">
                <Text className="font-sans-bold text-sm text-neutral-800 dark:text-dark-text">
                    {isIn ? 'Entrada' : 'Saída'}
                </Text>
                <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                    {showDate
                        ? `${formatDateBR(record.recorded_at)} · ${formatTimeBR(record.recorded_at)}`
                        : formatTimeBR(record.recorded_at)}
                </Text>
                {outOfRadius ? (
                    <View className="mt-1">
                        <Badge
                            label="Fora do raio"
                            variant="warning"
                            size="sm"
                            icon="warning-outline"
                        />
                    </View>
                ) : null}
            </View>

            {record.photo_url ? (
                <Image
                    source={{ uri: resolveMediaUrl(record.photo_url), headers: mediaHeaders() }}
                    style={{ width: 40, height: 40, borderRadius: 8 }}
                    contentFit="cover"
                    accessibilityLabel="Foto da batida"
                />
            ) : null}
        </View>
    );
}
