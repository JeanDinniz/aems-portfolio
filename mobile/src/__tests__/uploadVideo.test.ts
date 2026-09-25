import {
    uploadVideo,
    validateVideoSize,
    UploadVideoError,
    type LocalVideoAsset,
} from '@/services/upload/uploadVideo';

/**
 * VID-01 — uploadVideo.
 * Espelha uploadPhoto.test.ts: mocka apiClient.post e valida:
 *   - Validação de tamanho local (≤ 50 MB) — rejeita antes do upload se exceder.
 *   - FormData com campo `file`, header multipart, timeout 180s.
 *   - Retorno de `data.url`.
 *   - Repasse de progresso (onUploadProgress → onProgress).
 *   - Tratamento dos erros 413/415/422/500 (UploadVideoError com mensagem amigável).
 */

const mockPost = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        post: (...args: unknown[]) => mockPost(...args),
        get: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const video: LocalVideoAsset = {
    uri: 'file:///video.mp4',
    name: 'video.mp4',
    mime: 'video/mp4',
    fileSize: 10 * 1024 * 1024, // 10 MB — dentro do limite
};

/** Erro com shape de AxiosError (para getApiErrorStatus/getApiErrorMessage). */
function axiosError(status: number, data: unknown = {}) {
    return Object.assign(new Error(`HTTP ${status}`), {
        isAxiosError: true,
        response: { status, data },
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ data: { url: 'https://cdn/aems/video.mp4' } });
});

// ─── validateVideoSize ────────────────────────────────────────────────────────

describe('validateVideoSize', () => {
    it('não lança quando fileSize é exatamente 50 MB', () => {
        expect(() => validateVideoSize({ uri: 'x', fileSize: 50 * 1024 * 1024 })).not.toThrow();
    });

    it('não lança quando fileSize está ausente (backend valida)', () => {
        expect(() => validateVideoSize({ uri: 'x' })).not.toThrow();
    });

    it('lança UploadVideoError quando fileSize excede 50 MB', () => {
        expect(() =>
            validateVideoSize({ uri: 'x', fileSize: 51 * 1024 * 1024 })
        ).toThrow(UploadVideoError);
    });

    it('a mensagem de erro menciona 50 MB', () => {
        let msg = '';
        try {
            validateVideoSize({ uri: 'x', fileSize: 60 * 1024 * 1024 });
        } catch (e) {
            msg = (e as Error).message;
        }
        expect(msg).toContain('50 MB');
    });

    it('não faz o upload quando fileSize > 50 MB', async () => {
        const bigVideo: LocalVideoAsset = { uri: 'file:///big.mp4', fileSize: 51 * 1024 * 1024 };
        await expect(uploadVideo(bigVideo)).rejects.toBeInstanceOf(UploadVideoError);
        // O apiClient.post NÃO deve ser chamado (fail-fast antes do upload)
        expect(mockPost).not.toHaveBeenCalled();
    });
});

// ─── uploadVideo — request ────────────────────────────────────────────────────

describe('uploadVideo — request', () => {
    it('envia FormData no endpoint correto, com header multipart e timeout 180s', async () => {
        await uploadVideo(video);

        expect(mockPost).toHaveBeenCalledTimes(1);
        const [url, body, config] = mockPost.mock.calls[0];
        expect(url).toBe('/upload/video');
        expect(body).toBeInstanceOf(FormData);
        expect(config.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
        expect(config.timeout).toBe(180_000);
    });

    it('o FormData contém o campo `file`', async () => {
        await uploadVideo(video);
        const body = mockPost.mock.calls[0][1] as FormData;
        expect(body.has('file')).toBe(true);
    });

    it('retorna a url da resposta', async () => {
        const url = await uploadVideo(video);
        expect(url).toBe('https://cdn/aems/video.mp4');
    });
});

// ─── uploadVideo — progresso ──────────────────────────────────────────────────

describe('uploadVideo — progresso', () => {
    it('repassa onProgress a partir de onUploadProgress (0-100)', async () => {
        mockPost.mockImplementationOnce(async (_url, _body, config) => {
            config.onUploadProgress({ loaded: 25, total: 100 });
            config.onUploadProgress({ loaded: 100, total: 100 });
            return { data: { url: 'https://cdn/v.mp4' } };
        });

        const progress: number[] = [];
        await uploadVideo(video, (p) => progress.push(p));
        expect(progress).toEqual([25, 100]);
    });

    it('ignora eventos sem total (não chama onProgress)', async () => {
        mockPost.mockImplementationOnce(async (_url, _body, config) => {
            config.onUploadProgress({ loaded: 10, total: 0 });
            return { data: { url: 'https://cdn/v.mp4' } };
        });
        const onProgress = jest.fn();
        await uploadVideo(video, onProgress);
        expect(onProgress).not.toHaveBeenCalled();
    });
});

// ─── uploadVideo — erros ──────────────────────────────────────────────────────

describe('uploadVideo — erros', () => {
    it('resposta sem url lança UploadVideoError', async () => {
        mockPost.mockResolvedValueOnce({ data: {} });
        await expect(uploadVideo(video)).rejects.toBeInstanceOf(UploadVideoError);
    });

    it('413 → mensagem de vídeo muito grande', async () => {
        mockPost.mockRejectedValueOnce(axiosError(413));
        await expect(uploadVideo(video)).rejects.toMatchObject({
            name: 'UploadVideoError',
            status: 413,
            message: expect.stringContaining('50 MB'),
        });
    });

    it('415 → mensagem de formato não suportado', async () => {
        mockPost.mockRejectedValueOnce(axiosError(415));
        await expect(uploadVideo(video)).rejects.toMatchObject({
            status: 415,
            message: expect.stringContaining('não suportado'),
        });
    });

    it('422 → mensagem de vídeo não processável', async () => {
        mockPost.mockRejectedValueOnce(axiosError(422));
        await expect(uploadVideo(video)).rejects.toMatchObject({
            status: 422,
            message: expect.stringContaining('não pôde ser processado'),
        });
    });

    it('erro genérico (500) cai no fallback amigável', async () => {
        mockPost.mockRejectedValueOnce(axiosError(500, { detail: 'internal error' }));
        const err = (await uploadVideo(video).catch((e) => e)) as UploadVideoError;
        expect(err).toBeInstanceOf(UploadVideoError);
        expect(err.status).toBe(500);
        expect(err.message).toBe('internal error');
    });
});
