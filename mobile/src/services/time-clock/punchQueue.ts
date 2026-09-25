/**
 * Fila offline PERSISTENTE da batida de ponto (Portaria MTP 671/2021).
 *
 * A marcação de ponto NUNCA pode ser impedida por falta de rede — este é o
 * princípio do controle interno endurecido. Por isso, diferente da fila de
 * upload de O.S. (que enfileira só a FOTO), aqui enfileiramos a BATIDA INTEIRA:
 * a selfie local, o tipo (in/out), a geolocalização, o embedding facial e o
 * `client_reported_at` (horário do relógio do aparelho no instante da batida).
 *
 * Fluxo por item pendente (rodado SERIALMENTE, um por vez):
 *   1. Faz upload da selfie local (`uploadPhoto`) → obtém a `photo_url`.
 *   2. Chama `POST /time-clock/punch` com a `photo_url` + coordenadas + embedding
 *      + o `client_reported_at` PRESERVADO (o servidor registra a hora do sync
 *      como horário oficial, mas o instante real fica no metadado).
 *
 * Reprocessa quando o app volta ao foreground e quando a rede reconecta
 * (mesmo padrão de ciclo de vida do `uploadQueue`). Retry com backoff
 * (1→2→4…30s) para erros transitórios; erros PERMANENTES 4xx (ex.: 422 sem
 * vínculo de funcionário) param aguardando ação — nunca re-tentam infinitamente.
 *
 * Espelha as decisões do `uploadQueue`:
 * - Metadados em `appStorage` (AsyncStorage), NUNCA em SecureStore.
 * - A selfie é COPIADA para `Paths.document/aems-punch-queue/` (sobrevive entre
 *   sessões) e removida quando o item sai da fila.
 * - Processamento serial, sem duplicar envio (item em `sending` não re-dispara).
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';

import { appStorage } from '@/lib/storage';
import { addBreadcrumb, captureException } from '@/lib/sentry';
import { getApiErrorStatus } from '@/lib/api-error';
import { uploadPhoto, UploadError } from '@/services/upload/uploadPhoto';
import { timeClockService } from '@/services/api/time-clock.service';
import type { LocalPhotoAsset } from '@/types/photo.types';
import type { PunchType } from '@/types/time-clock.types';

const STORAGE_KEY = 'aems_punch_queue_v1';
const QUEUE_DIR_NAME = 'aems-punch-queue';

const BASE_BACKOFF_MS = 1_000; // 1s
const MAX_BACKOFF_MS = 30_000; // teto de 30s

/**
 * Status HTTP PERMANENTES (erro do cliente): re-tentar a MESMA batida nunca vai
 * passar (ex.: 422 = usuário sem vínculo de funcionário; 413/415 = foto
 * inválida). O item para em erro e não reprocessa sozinho — evita loop infinito.
 * Erros transitórios (rede, timeout, 5xx, 408, 429, sem status) reprocessam com
 * backoff — é o comportamento de fila offline esperado.
 */
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422]);

/** Extrai o status HTTP de um erro de upload OU de punch (AxiosError). */
function statusOf(error: unknown): number | undefined {
    if (error instanceof UploadError) return error.status;
    return getApiErrorStatus(error as Error);
}

/** `true` se o erro tem status HTTP permanente (não reprocessa sozinho). */
function isPermanentError(error: unknown): boolean {
    const status = statusOf(error);
    return typeof status === 'number' && PERMANENT_HTTP_STATUSES.has(status);
}

/** Estado de um item da fila de batida. */
export type PunchQueueStatus = 'queued' | 'sending' | 'error';

/** Item persistido da fila de batida (a batida inteira, não só a foto). */
export interface PunchQueueItem {
    /** Id estável do item. */
    id: string;
    /** Entrada ou saída. */
    type: PunchType;
    /** URI local da cópia da selfie (no diretório do app). */
    localUri: string;
    /** MIME da selfie (para o multipart do upload). */
    mime: string;
    /** Nome do arquivo da selfie. */
    name: string;
    latitude: number;
    longitude: number;
    /** Precisão horizontal (m), quando o aparelho reportou. */
    accuracy_m?: number;
    /** Embedding facial gerado no aparelho (Fase 2); ausente se sem cadastro. */
    face_embedding?: number[];
    /** Horário do relógio do aparelho no instante da batida (ISO com fuso). */
    client_reported_at: string;
    status: PunchQueueStatus;
    /** Tentativas de envio já feitas (para o backoff). */
    attempts: number;
    /** Mensagem de erro do último envio falho. */
    error?: string;
    /** `true` quando o último erro é PERMANENTE (não há retry automático). */
    permanent?: boolean;
    /** Epoch ms de criação (usado para ordenar/exibir). */
    createdAt: number;
}

/** Dados de uma batida pendente (o que a tela passa ao enfileirar). */
export interface EnqueuePunchInput {
    type: PunchType;
    /** Selfie JÁ COMPRIMIDA (será copiada para o diretório do app). */
    asset: LocalPhotoAsset;
    latitude: number;
    longitude: number;
    accuracy_m?: number;
    face_embedding?: number[];
    /** Horário do relógio do aparelho no instante da batida (ISO com fuso). */
    client_reported_at: string;
}

type Listener = (items: PunchQueueItem[]) => void;

// ─── Estado em memória (espelho da persistência) ─────────────────────────────

const items = new Map<string, PunchQueueItem>();
const listeners = new Set<Listener>();

let hydrated = false;
let hydration: Promise<void> | null = null;
let processing = false;
let queuedReprocess = false;
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

let appStateSub: NativeEventSubscription | null = null;
let netInfoUnsub: (() => void) | null = null;
let lifecycleStarted = false;

let seq = 0;
function makeId(): string {
    seq += 1;
    return `punch_${Date.now()}_${seq}`;
}

// ─── Diretório do app para as selfies copiadas ───────────────────────────────

function queueDir(): Directory {
    return new Directory(Paths.document, QUEUE_DIR_NAME);
}

function ensureQueueDir(): Directory {
    const dir = queueDir();
    if (!dir.exists) {
        dir.create({ intermediates: true, idempotent: true });
    }
    return dir;
}

function extensionFor(asset: LocalPhotoAsset): string {
    const fromUri = asset.uri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/)?.[0];
    if (fromUri) return fromUri.toLowerCase();
    if (asset.mime === 'image/png') return '.png';
    if (asset.mime === 'image/webp') return '.webp';
    return '.jpg';
}

/** Copia a selfie comprimida para o diretório do app; retorna o URI persistente. */
function copyIntoQueue(asset: LocalPhotoAsset, id: string): string {
    const dir = ensureQueueDir();
    const dest = new File(dir, `${id}${extensionFor(asset)}`);
    if (dest.exists) dest.delete();
    new File(asset.uri).copy(dest);
    return dest.uri;
}

/** Remove o arquivo local de um item (silencioso se já não existir). */
function deleteLocalFile(localUri: string): void {
    try {
        const file = new File(localUri);
        if (file.exists) file.delete();
    } catch {
        // arquivo já removido / inacessível — sem ação
    }
}

// ─── Persistência ────────────────────────────────────────────────────────────

async function persist(): Promise<void> {
    await appStorage.set(STORAGE_KEY, Array.from(items.values()));
}

/** Carrega a fila persistida (uma vez). Itens `sending` voltam a `queued`. */
async function hydrate(): Promise<void> {
    if (hydrated) return;
    if (hydration) return hydration;
    hydration = (async () => {
        const stored = (await appStorage.get<PunchQueueItem[]>(STORAGE_KEY)) ?? [];
        for (const raw of stored) {
            // Um item que ficou em `sending` ao matar o app deve ser reprocessado.
            const status: PunchQueueStatus = raw.status === 'sending' ? 'queued' : raw.status;
            items.set(raw.id, { ...raw, status });
        }
        hydrated = true;
    })();
    return hydration;
}

/** Garante que a fila foi carregada do disco antes de ler `getItems`. */
export async function ensureHydrated(): Promise<void> {
    await hydrate();
}

// ─── Notificação para a UI ───────────────────────────────────────────────────

function snapshot(): PunchQueueItem[] {
    return Array.from(items.values())
        .map((it) => ({ ...it }))
        .sort((a, b) => a.createdAt - b.createdAt);
}

function notify(): void {
    const snap = snapshot();
    for (const l of listeners) l(snap);
}

function patch(id: string, p: Partial<PunchQueueItem>): void {
    const item = items.get(id);
    if (!item) return;
    items.set(id, { ...item, ...p });
}

// ─── Backoff ─────────────────────────────────────────────────────────────────

/** 1s, 2s, 4s, 8s… com teto de 30s. `attempts` = tentativas já feitas. */
function backoffMs(attempts: number): number {
    const ms = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
    return Math.min(ms, MAX_BACKOFF_MS);
}

function scheduleRetry(id: string): void {
    const item = items.get(id);
    if (!item) return;
    if (retryTimers.has(id)) return; // já agendado
    const timer = setTimeout(() => {
        retryTimers.delete(id);
        const cur = items.get(id);
        if (cur && cur.status === 'error' && !cur.permanent) {
            patch(id, { status: 'queued', error: undefined });
            void persistAndProcess();
        }
    }, backoffMs(item.attempts));
    retryTimers.set(id, timer);
}

function clearRetryTimer(id: string): void {
    const timer = retryTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        retryTimers.delete(id);
    }
}

// ─── Processamento serial ────────────────────────────────────────────────────

async function persistAndProcess(): Promise<void> {
    await persist();
    void processQueue();
}

function nextQueued(): PunchQueueItem | undefined {
    for (const item of items.values()) {
        if (item.status === 'queued') return item;
    }
    return undefined;
}

/**
 * Processa as batidas pendentes SERIALMENTE. Reentrante: se chamado durante um
 * processamento, agenda um reprocesso no fim (não dispara envios paralelos).
 */
export async function processQueue(): Promise<void> {
    await hydrate();
    if (processing) {
        queuedReprocess = true;
        return;
    }
    processing = true;
    try {
        let item = nextQueued();
        while (item) {
            await sendItem(item.id);
            item = nextQueued();
        }
    } finally {
        processing = false;
        if (queuedReprocess) {
            queuedReprocess = false;
            void processQueue();
        }
    }
}

/**
 * Envia UMA batida pendente: upload da selfie → `POST /time-clock/punch` com o
 * `client_reported_at` preservado. Em sucesso, remove o item e apaga a selfie.
 */
async function sendItem(id: string): Promise<void> {
    const item = items.get(id);
    if (!item || item.status !== 'queued') return;

    patch(id, { status: 'sending', error: undefined, permanent: undefined });
    notify();

    try {
        // 1) Upload da selfie local (obtém a URL no servidor).
        const photoUrl = await uploadPhoto({
            uri: item.localUri,
            mime: item.mime,
            name: item.name,
        });

        // 2) Batida — o horário do aparelho vira o horário OFICIAL (REP-A): esta
        //    batida foi coletada OFFLINE e está sendo sincronizada agora.
        await timeClockService.punch({
            type: item.type,
            photo_url: photoUrl,
            latitude: item.latitude,
            longitude: item.longitude,
            accuracy_m: item.accuracy_m,
            face_embedding: item.face_embedding,
            client_reported_at: item.client_reported_at,
            is_offline: true,
        });

        // Sucesso: sai da fila e apaga a selfie copiada.
        clearRetryTimer(id);
        deleteLocalFile(item.localUri);
        items.delete(id);
        await persist();
        notify();
        addBreadcrumb('punch-queue', 'sync-success', { id });
    } catch (error) {
        const attempts = (items.get(id)?.attempts ?? 0) + 1;
        const permanent = isPermanentError(error);
        patch(id, {
            status: 'error',
            attempts,
            error: error instanceof Error ? error.message : 'Falha ao enviar a batida.',
            permanent,
        });
        await persist();
        notify();
        addBreadcrumb('punch-queue', 'sync-fail', { id, attempts, permanent });
        // Erros permanentes na 1ª (nunca passam sozinhos); transitórios a partir da 3ª.
        if (permanent || attempts >= 3) {
            captureException(error, { context: 'punchQueue.sendItem', attempts, permanent });
        }
        // Só reagenda erros TRANSITÓRIOS. Permanentes param aguardando ação manual.
        if (!permanent) {
            scheduleRetry(id);
        }
    }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Enfileira uma batida completa: copia a selfie para o diretório do app, grava o
 * item em `appStorage` e dispara o processamento. Retorna o id do item.
 */
export async function enqueue(input: EnqueuePunchInput): Promise<string> {
    await hydrate();
    const id = makeId();
    const localUri = copyIntoQueue(input.asset, id);
    const item: PunchQueueItem = {
        id,
        type: input.type,
        localUri,
        mime: input.asset.mime ?? 'image/jpeg',
        name: input.asset.name ?? 'ponto.jpg',
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy_m: input.accuracy_m,
        face_embedding: input.face_embedding,
        client_reported_at: input.client_reported_at,
        status: 'queued',
        attempts: 0,
        createdAt: Date.now(),
    };
    items.set(id, item);
    await persist();
    notify();
    addBreadcrumb('punch-queue', 'enqueue', { id, type: input.type });
    void processQueue();
    return id;
}

/** Retry manual de uma batida em erro: zera o backoff e reprocessa na hora. */
export async function retry(id: string): Promise<void> {
    await hydrate();
    const item = items.get(id);
    if (!item) return;
    clearRetryTimer(id);
    patch(id, { status: 'queued', error: undefined, attempts: 0, permanent: undefined });
    addBreadcrumb('punch-queue', 'retry', { id });
    await persistAndProcess();
}

/** Remove uma batida da fila e apaga a selfie local (descartar pendente). */
export async function remove(id: string): Promise<void> {
    await hydrate();
    const item = items.get(id);
    if (!item) return;
    clearRetryTimer(id);
    deleteLocalFile(item.localUri);
    items.delete(id);
    await persist();
    notify();
}

/** Snapshot em memória de todas as batidas pendentes (após hydrate). */
export function getItems(): PunchQueueItem[] {
    return snapshot();
}

/** Quantidade de batidas pendentes (na fila ou em erro). */
export function pendingCount(): number {
    return items.size;
}

/** Inscreve para mudanças na fila. Entrega o snapshot atual ao inscrever. */
export function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    void hydrate().then(() => listener(snapshot()));
    return () => {
        listeners.delete(listener);
    };
}

// ─── Ciclo de vida: foreground + reconexão de rede ───────────────────────────

function onAppStateChange(state: AppStateStatus): void {
    if (state === 'active') {
        void processQueue();
    }
}

function onNetChange(state: NetInfoState): void {
    // `isConnected` pode ser null; tratamos null como online (otimista — se
    // falhar, o item volta a erro e reagenda com backoff).
    if (state.isConnected !== false) {
        void processQueue();
    }
}

/** Liga os reprocessos automáticos (foreground + reconexão). Idempotente. */
export function startLifecycle(): void {
    if (lifecycleStarted) return;
    lifecycleStarted = true;
    appStateSub = AppState.addEventListener('change', onAppStateChange);
    netInfoUnsub = NetInfo.addEventListener(onNetChange);
    // Drena o que sobrou de sessões anteriores.
    void processQueue();
}

/** Desliga os listeners de ciclo de vida (cleanup). */
export function stopLifecycle(): void {
    lifecycleStarted = false;
    appStateSub?.remove();
    appStateSub = null;
    netInfoUnsub?.();
    netInfoUnsub = null;
}

/** APENAS para testes: limpa todo o estado em memória + persistência. */
export async function resetForTests(): Promise<void> {
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    items.clear();
    listeners.clear();
    hydrated = false;
    hydration = null;
    processing = false;
    queuedReprocess = false;
    await appStorage.remove(STORAGE_KEY);
}
