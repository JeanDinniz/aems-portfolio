/**
 * Infra de exportação de Excel (Sprint 6 — Fatia 4).
 *
 * Baixa um binário .xlsx da API (responseType: 'arraybuffer'), grava num arquivo
 * temporário no diretório de cache do app (expo-file-system v19 — File/Directory/
 * Paths) e abre a folha de compartilhamento nativa (expo-sharing) para o usuário
 * salvar/enviar a planilha.
 *
 * Por que arquivo + share (e não download direto): um app React Native não tem
 * "pasta de downloads do browser"; o caminho nativo é materializar o arquivo e
 * delegar ao SO o destino (Arquivos, Drive, e-mail, WhatsApp...).
 *
 * Decisões:
 * - Reusa o `apiClient` (Bearer + refresh) — o backend autentica o export.
 * - Escrita via `file.write(base64, { encoding: 'base64' })` da API v19. O
 *   ArrayBuffer da resposta é convertido para base64 de forma CHUNKED (sem
 *   `String.fromCharCode(...bytes)` em spread, que estoura a pilha no Hermes
 *   para arquivos grandes) e SEM libs externas.
 * - NÃO mostra toast aqui: resolve ou lança um Error com mensagem amigável; a
 *   tela decide o feedback (sucesso/erro).
 */
import { Directory, File, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { apiClient } from '@/services/api/client';

/**
 * Carrega `expo-sharing` de forma TARDIA e segura. O módulo nativo `ExpoSharing`
 * só existe em binários que o incluíram no build (dev build/preview/produção
 * recompilados). Um `import` estático no topo faz `requireNativeModule` na carga
 * e, se ausente, DERRUBA o app inteiro no boot ("runtime not ready").
 *
 * Um `require()` em try/catch NÃO basta em DEV: o Metro (`guardedLoadModule`)
 * reporta o erro de módulo nativo ausente direto na RedBox ANTES do catch. Por
 * isso sondamos primeiro com `requireOptionalNativeModule` (consulta o registro
 * nativo e retorna null sem lançar); só então carregamos o wrapper JS.
 */
type SharingModule = typeof import('expo-sharing');
function getSharing(): SharingModule | null {
    try {
        if (!requireOptionalNativeModule('ExpoSharing')) return null;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('expo-sharing') as SharingModule;
    } catch {
        return null;
    }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';

// ─── base64 (chunked, sem libs) ──────────────────────────────────────────────
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Converte um ArrayBuffer em base64 sem depender de `btoa`/`Buffer` (que podem
 * não existir no Hermes) e sem espalhar o array inteiro num `fromCharCode`
 * (que estoura a pilha). Implementação direta do encode base64, byte a byte.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const len = bytes.length;
    let result = '';

    for (let i = 0; i < len; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < len ? bytes[i + 1] : 0;
        const b2 = i + 2 < len ? bytes[i + 2] : 0;

        result += B64_CHARS[b0 >> 2];
        result += B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
        result += i + 1 < len ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
        result += i + 2 < len ? B64_CHARS[b2 & 0x3f] : '=';
    }

    return result;
}

export interface DownloadAndShareExcelOptions {
    /** Caminho do endpoint de export na API (ex.: '/service-orders/export/conferencia'). */
    path: string;
    /** Query params (axios serializa arrays como `key=a&key=b`). */
    params?: Record<string, unknown>;
    /** Nome do arquivo .xlsx criado no cache e usado no diálogo de compartilhar. */
    filename: string;
}

/**
 * Baixa o .xlsx do `path` (com `params`), grava em `Paths.cache/{filename}` e
 * abre o compartilhamento nativo. Resolve ao concluir; lança Error amigável em
 * qualquer falha (sem toast — a tela trata).
 */
export async function downloadAndShareExcel(opts: DownloadAndShareExcelOptions): Promise<void> {
    const Sharing = getSharing();
    if (!Sharing || !(await Sharing.isAvailableAsync())) {
        throw new Error(
            'Compartilhamento indisponível neste app. Atualize para o build completo para exportar.'
        );
    }

    const response = await apiClient.get<ArrayBuffer>(opts.path, {
        params: opts.params,
        // Arrays viram chaves repetidas (`flag=a&flag=b`) — formato que o backend
        // espera, em vez do default do axios (`flag[]=a&flag[]=b`).
        paramsSerializer: { indexes: null },
        responseType: 'arraybuffer',
    });

    const base64 = arrayBufferToBase64(response.data);

    // Garante o diretório de cache e materializa o arquivo.
    const cacheDir = new Directory(Paths.cache);
    if (!cacheDir.exists) {
        cacheDir.create({ intermediates: true, idempotent: true });
    }

    const file = new File(Paths.cache, opts.filename);
    if (file.exists) {
        file.delete();
    }
    file.create();
    file.write(base64, { encoding: 'base64' });

    await Sharing.shareAsync(file.uri, {
        mimeType: XLSX_MIME,
        dialogTitle: opts.filename,
        UTI: XLSX_UTI,
    });
}
