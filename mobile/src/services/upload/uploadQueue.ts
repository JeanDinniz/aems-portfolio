/**
 * CAM-05 — Fila offline de upload persistente.
 *
 * É a peça mais crítica do app: o lançamento de O.S. com fotos acontece em
 * loja/galpão com rede instável. Diferente do web (upload fire-and-forget), aqui
 * a foto comprimida é COPIADA para o diretório do app e enfileirada de forma
 * PERSISTENTE; o upload roda com paralelismo limitado + retry/backoff e é reprocessado quando o
 * app volta ao foreground ou a rede reconecta. A O.S. só é submetida quando todas
 * as fotos obrigatórias já têm `url` — enquanto pendente, o estado "salvando…"
 * sobrevive a fechar/reabrir o app. Doc 04 §5.
 *
 * Decisões importantes:
 * - Metadados da fila ficam em `appStorage` (AsyncStorage), NUNCA em SecureStore.
 * - Arquivos comprimidos são copiados para `Paths.document/aems-upload-queue/`
 *   (sobrevivem entre sessões) e removidos quando o item sai da fila.
 * - Processamento com paralelismo LIMITADO (`MAX_CONCURRENT_UPLOADS`); a COMPRESSÃO
 *   continua serial (mutex), que é o que evita o pico de memória — só POSTs de
 *   arquivos já comprimidos correm em paralelo (ADR upload moderado 2026-08-31).
 * - Sem duplicar upload: o item em `uploading` nunca é re-disparado.
 *
 * API pública (consumida por PhotoCapture e pela tela de Criar O.S.):
 *   - enqueue(asset, opts?)         → Promise<string> (id do item)
 *   - processQueue()                → Promise<void>
 *   - retry(id)                     → Promise<void> (retry manual de item em erro)
 *   - remove(id)                    → Promise<void> (cancela e apaga o arquivo)
 *   - getItem(id)                   → QueueItem | undefined (snapshot em memória)
 *   - getItems(ids)                 → QueueItem[]
 *   - getDraftItems(osDraftId)      → QueueItem[]
 *   - isDraftComplete(osDraftId, expectedIds?) → boolean
 *   - getDraftUrls(osDraftId, ids?) → (string | null)[] (na ordem de `ids`, se dado)
 *   - pruneUploaded(ids)            → Promise<void> (poda itens já consumidos)
 *   - subscribe(listener)           → unsubscribe
 *   - subscribeItem(id, listener)   → unsubscribe
 *   - startLifecycle() / stopLifecycle()
 *   - resetForTests()               → limpa estado (apenas testes)
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';

import { appStorage } from '@/lib/storage';
import { addBreadcrumb, captureException } from '@/lib/sentry';
import type { LocalPhotoAsset } from '@/types/photo.types';
import { uploadPhoto, UploadError } from './uploadPhoto';

const STORAGE_KEY = 'aems_upload_queue_v1';
const QUEUE_DIR_NAME = 'aems-upload-queue';

const BASE_BACKOFF_MS = 1_000; // 1s
const MAX_BACKOFF_MS = 30_000; // teto de 30s

/**
 * Upload mobile "moderado" (ADR 2026-08-31): até N POSTs de foto em paralelo.
 * Antes era 1 (serial). A COMPRESSÃO continua serial (mutex em compressPhoto.ts)
 * — o anti-pico de memória é da manipulação nativa da imagem, não do POST; aqui
 * só sobem arquivos JÁ comprimidos. REVERTER ao comportamento serial = setar 1.
 */
const MAX_CONCURRENT_UPLOADS = 3;

/**
 * Status HTTP PERMANENTES (erro do cliente): re-tentar o MESMO arquivo nunca vai
 * passar, então não há retry automático — o item para em erro e só o retry
 * manual (ou remover a foto) resolve. Cobre o caso do CSRF/Origin (403) que
 * causava o "loop infinito de envio". Erros transitórios (rede, timeout, 5xx,
 * 408, 429, sem status) continuam reprocessando com backoff — é o comportamento
 * de fila offline esperado.
 */
const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 405, 409, 413, 415, 422]);

/** `true` se o erro é um `UploadError` com status HTTP permanente (não reprocessa). */
function isPermanentError(error: unknown): boolean {
    return (
        error instanceof UploadError &&
        typeof error.status === 'number' &&
        PERMANENT_HTTP_STATUSES.has(error.status)
    );
}

/** Estado de um item da fila. */
export type QueueItemStatus = 'queued' | 'uploading' | 'uploaded' | 'error';

/** Item persistido da fila de upload. */
export interface QueueItem {
    /** Id estável do item (também usado como referência foto↔item pela UI). */
    id: string;
    /** URI local da cópia da foto comprimida (no diretório do app). */
    localUri: string;
    /** Tipo MIME (para o multipart). */
    mime: string;
    /** Nome do arquivo (para o multipart). */
    name: string;
    status: QueueItemStatus;
    /** Tentativas de upload já feitas (para o backoff). */
    attempts: number;
    /** Progresso 0-100 do upload em andamento. */
    progress: number;
    /** URL no servidor após upload bem-sucedido. */
    url?: string;
    /** Mensagem de erro do último upload falho. */
    error?: string;
    /**
     * `true` quando o último erro é PERMANENTE (4xx de cliente: origem/CSRF,
     * arquivo inválido, tipo não suportado etc.). Nesse caso NÃO há retry
     * automático — o item para no estado de erro aguardando ação manual, pois
     * re-tentar o mesmo arquivo daria o mesmo erro (evita loop infinito).
     */
    permanent?: boolean;
    /** Epoch ms de criação. */
    createdAt: number;
    /** Vínculo opcional ao rascunho de O.S. (UX "salvando…" persistente). */
    osDraftId?: string;
}

/** Opções de enfileiramento. */
export interface EnqueueOptions {
    /** Vincula a foto a um rascunho de O.S. local. */
    osDraftId?: string;
    /** Id explícito (default: gerado). Útil para casar com a UI. */
    id?: string;
}

type Listener = (items: QueueItem[]) => void;
type ItemListener = (item: QueueItem | undefined) => void;

// ─── Estado em memória (espelho da persistência) ─────────────────────────────

const items = new Map<string, QueueItem>();
const listeners = new Set<Listener>();
const itemListeners = new Map<string, Set<ItemListener>>();

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
    return `up_${Date.now()}_${seq}`;
}

// ─── Diretório do app para os arquivos copiados ──────────────────────────────

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

/**
 * Copia a foto comprimida para o diretório do app, preservando a extensão.
 * Retorna o URI local persistente.
 */
function copyIntoQueue(asset: LocalPhotoAsset, id: string): string {
    const dir = ensureQueueDir();
    const ext = extensionFor(asset);
    const dest = new File(dir, `${id}${ext}`);
    if (dest.exists) {
        dest.delete();
    }
    const source = new File(asset.uri);
    source.copy(dest);
    return dest.uri;
}

function extensionFor(asset: LocalPhotoAsset): string {
    const fromUri = asset.uri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/)?.[0];
    if (fromUri) return fromUri.toLowerCase();
    if (asset.mime === 'image/png') return '.png';
    if (asset.mime === 'image/webp') return '.webp';
    return '.jpg';
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

/** Carrega a fila persistida (uma vez). Itens `uploading` voltam a `queued`. */
async function hydrate(): Promise<void> {
    if (hydrated) return;
    if (hydration) return hydration;
    hydration = (async () => {
        const stored = (await appStorage.get<QueueItem[]>(STORAGE_KEY)) ?? [];
        for (const raw of stored) {
            // Um item que ficou em `uploading` ao matar o app deve ser reprocessado.
            const status: QueueItemStatus = raw.status === 'uploading' ? 'queued' : raw.status;
            items.set(raw.id, { ...raw, status, progress: status === 'uploaded' ? 100 : 0 });
        }
        hydrated = true;
    })();
    return hydration;
}

/**
 * Garante que a fila foi carregada do disco (AsyncStorage). Necessário antes de
 * ler itens com `getItem`/`getItems` logo no BOOT A FRIO — quando o mapa em
 * memória ainda está vazio (ex.: restaurar fotos de um rascunho ao reabrir o app).
 */
export async function ensureHydrated(): Promise<void> {
    await hydrate();
}

// ─── Notificação para a UI ───────────────────────────────────────────────────

function snapshot(): QueueItem[] {
    return Array.from(items.values()).map((it) => ({ ...it }));
}

function notify(changedId?: string): void {
    const snap = snapshot();
    for (const l of listeners) l(snap);
    if (changedId) {
        const set = itemListeners.get(changedId);
        if (set) {
            const item = items.get(changedId);
            const copy = item ? { ...item } : undefined;
            for (const l of set) l(copy);
        }
    }
}

function patch(id: string, p: Partial<QueueItem>): void {
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
    const delay = backoffMs(item.attempts);
    const timer = setTimeout(() => {
        retryTimers.delete(id);
        const cur = items.get(id);
        if (cur && cur.status === 'error') {
            patch(id, { status: 'queued', error: undefined });
            void persistAndProcess();
        }
    }, delay);
    retryTimers.set(id, timer);
}

function clearRetryTimer(id: string): void {
    const timer = retryTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        retryTimers.delete(id);
    }
}

// ─── Processamento (paralelismo limitado) ────────────────────────────────────

async function persistAndProcess(): Promise<void> {
    await persist();
    void processQueue();
}

function nextQueued(): QueueItem | undefined {
    for (const item of items.values()) {
        if (item.status === 'queued') return item;
    }
    return undefined;
}

/**
 * Processa os itens pendentes com paralelismo limitado a `MAX_CONCURRENT_UPLOADS`.
 * Reentrante: se chamado durante um processamento, agenda um reprocesso no fim.
 *
 * `uploadItem` marca o item como `uploading` de forma SÍNCRONA (antes do primeiro
 * `await`), então `nextQueued()` nunca devolve um item já em voo — não há duplo
 * disparo mesmo lançando vários em paralelo. `uploadItem` nunca rejeita (trata o
 * erro internamente), logo o pool não precisa de try/catch por tarefa.
 */
export async function processQueue(): Promise<void> {
    await hydrate();
    if (processing) {
        queuedReprocess = true;
        return;
    }
    processing = true;
    try {
        const inFlight = new Set<Promise<void>>();
        const pump = () => {
            while (inFlight.size < MAX_CONCURRENT_UPLOADS) {
                const item = nextQueued();
                if (!item) break;
                const p = uploadItem(item.id);
                inFlight.add(p);
                void p.finally(() => inFlight.delete(p));
            }
        };
        pump();
        while (inFlight.size > 0) {
            await Promise.race(inFlight);
            pump();
        }
    } finally {
        processing = false;
        if (queuedReprocess) {
            queuedReprocess = false;
            void processQueue();
        }
    }
}

async function uploadItem(id: string): Promise<void> {
    const item = items.get(id);
    if (!item || item.status !== 'queued') return;

    patch(id, { status: 'uploading', progress: 0, error: undefined, permanent: undefined });
    notify(id);

    const asset: LocalPhotoAsset = {
        uri: item.localUri,
        mime: item.mime,
        name: item.name,
    };

    try {
        const url = await uploadPhoto(asset, (percent) => {
            patch(id, { progress: percent });
            notify(id);
        });
        patch(id, { status: 'uploaded', progress: 100, url, error: undefined });
        await persist();
        notify(id);
        // Breadcrumb SEM URL (a `url` pode conter query assinada com token).
        addBreadcrumb('upload', 'success', { id });
    } catch (error) {
        const current = items.get(id);
        const attempts = (current?.attempts ?? 0) + 1;
        const permanent = isPermanentError(error);
        patch(id, {
            status: 'error',
            attempts,
            error: error instanceof Error ? error.message : 'Falha no envio.',
            permanent,
        });
        await persist();
        notify(id);
        // Breadcrumb de falha (sem URI/URL, só id + tentativa).
        addBreadcrumb('upload', 'fail', { id, attempts, permanent });
        // Falhas repetidas eram engolidas silenciosamente (só retry infinito).
        // A partir da 3ª tentativa, reporta ao Sentry para não perder o sinal de
        // uploads que nunca completam (rede ruim persistente / erro de servidor).
        // Erros permanentes reportam já na 1ª (nunca vão passar sozinhos).
        if (permanent || attempts >= 3) {
            captureException(error, { context: 'uploadQueue.uploadItem', attempts, permanent });
        }
        // Só reagenda erros TRANSITÓRIOS. Permanentes (4xx) param aqui e aguardam
        // retry manual — reagendar daria o mesmo erro para sempre (loop infinito).
        if (!permanent) {
            scheduleRetry(id);
        }
    }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Enfileira uma foto JÁ COMPRIMIDA: copia o arquivo para o diretório do app,
 * grava o item em `appStorage` e dispara o processamento. Retorna o id do item.
 */
export async function enqueue(asset: LocalPhotoAsset, opts: EnqueueOptions = {}): Promise<string> {
    await hydrate();
    const id = opts.id ?? makeId();
    const localUri = copyIntoQueue(asset, id);
    const item: QueueItem = {
        id,
        localUri,
        mime: asset.mime ?? 'image/jpeg',
        name: asset.name ?? 'photo.jpg',
        status: 'queued',
        attempts: 0,
        progress: 0,
        createdAt: Date.now(),
        osDraftId: opts.osDraftId,
    };
    items.set(id, item);
    await persist();
    notify(id);
    // Breadcrumb SEM URI local (só id + presença de rascunho).
    addBreadcrumb('upload', 'enqueue', { id, hasDraft: !!opts.osDraftId });
    void processQueue();
    return id;
}

/** Retry manual de um item em erro: zera o backoff e reprocessa imediatamente. */
export async function retry(id: string): Promise<void> {
    await hydrate();
    const item = items.get(id);
    if (!item) return;
    clearRetryTimer(id);
    if (item.status === 'uploaded') return;
    // Retry manual: zera o backoff e o marcador de erro permanente (o usuário
    // pediu explicitamente uma nova tentativa — ex.: config do servidor corrigida).
    patch(id, { status: 'queued', error: undefined, progress: 0, attempts: 0, permanent: undefined });
    addBreadcrumb('upload', 'retry', { id, attempts: item.attempts });
    await persistAndProcess();
}

/** Remove um item da fila e apaga o arquivo local copiado. */
export async function remove(id: string): Promise<void> {
    await hydrate();
    const item = items.get(id);
    if (!item) return;
    clearRetryTimer(id);
    deleteLocalFile(item.localUri);
    items.delete(id);
    await persist();
    notify(id);
}

/** Snapshot em memória de um item (após hydrate). */
export function getItem(id: string): QueueItem | undefined {
    const item = items.get(id);
    return item ? { ...item } : undefined;
}

/** Snapshot de vários itens, na ordem dos ids passados (ignora ids ausentes). */
export function getItems(ids: string[]): QueueItem[] {
    return ids.map((id) => items.get(id)).filter((it): it is QueueItem => !!it).map((it) => ({ ...it }));
}

/** Todos os itens de um rascunho de O.S. */
export function getDraftItems(osDraftId: string): QueueItem[] {
    return Array.from(items.values())
        .filter((it) => it.osDraftId === osDraftId)
        .map((it) => ({ ...it }));
}

/**
 * `true` quando todas as fotos pendentes já têm `url`. Se `expectedIds` for dado,
 * exige que TODOS existam e estejam `uploaded` (evita "completo" com fila vazia).
 */
export function isDraftComplete(osDraftId: string, expectedIds?: string[]): boolean {
    if (expectedIds) {
        if (expectedIds.length === 0) return true;
        return expectedIds.every((id) => items.get(id)?.status === 'uploaded' && !!items.get(id)?.url);
    }
    const draft = Array.from(items.values()).filter((it) => it.osDraftId === osDraftId);
    if (draft.length === 0) return false;
    return draft.every((it) => it.status === 'uploaded' && !!it.url);
}

/**
 * URLs finais para o payload da O.S. Quando `ids` é dado, devolve na MESMA ordem
 * (com `null` para itens ainda sem url). Sem `ids`, devolve as urls do rascunho
 * na ordem de criação.
 */
export function getDraftUrls(osDraftId: string, ids?: string[]): (string | null)[] {
    if (ids) {
        return ids.map((id) => items.get(id)?.url ?? null);
    }
    return Array.from(items.values())
        .filter((it) => it.osDraftId === osDraftId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((it) => it.url ?? null);
}

/**
 * Poda itens já consumidos pela O.S. (apaga arquivo local + remove da fila).
 * Chamar após submeter a O.S. com sucesso.
 */
export async function pruneUploaded(ids: string[]): Promise<void> {
    await hydrate();
    let changed = false;
    for (const id of ids) {
        const item = items.get(id);
        if (!item) continue;
        clearRetryTimer(id);
        deleteLocalFile(item.localUri);
        items.delete(id);
        changed = true;
    }
    if (changed) {
        await persist();
        notify();
    }
}

/** Inscreve para mudanças em QUALQUER item. Retorna a função de unsubscribe. */
export function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    // Entrega o snapshot atual logo após inscrever (após hydrate).
    void hydrate().then(() => listener(snapshot()));
    return () => {
        listeners.delete(listener);
    };
}

/** Inscreve para mudanças de UM item específico. Retorna o unsubscribe. */
export function subscribeItem(id: string, listener: ItemListener): () => void {
    let set = itemListeners.get(id);
    if (!set) {
        set = new Set();
        itemListeners.set(id, set);
    }
    set.add(listener);
    void hydrate().then(() => listener(getItem(id)));
    return () => {
        const s = itemListeners.get(id);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) itemListeners.delete(id);
    };
}

// ─── Ciclo de vida: foreground + reconexão de rede ───────────────────────────

function onAppStateChange(state: AppStateStatus): void {
    if (state === 'active') {
        void processQueue();
    }
}

function onNetChange(state: NetInfoState): void {
    // `isConnected` pode ser null em algumas plataformas; tratamos null como online
    // (otimista: tentar é melhor que ficar parado; o upload falha e reagenda).
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
    // Tenta processar o que sobrou de sessões anteriores.
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
    itemListeners.clear();
    hydrated = false;
    hydration = null;
    processing = false;
    queuedReprocess = false;
    await appStorage.remove(STORAGE_KEY);
}
