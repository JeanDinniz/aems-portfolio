import { uploadPhoto, UploadError } from '@/services/upload/uploadPhoto';
import type { LocalPhotoAsset } from '@/types/photo.types';

/**
 * CAM-03 — uploadPhoto. Mocka apiClient.post e valida: FormData com campo `file`,
 * header multipart, timeout 120s, retorno de `data.url`, repasse de progresso e
 * tratamento dos erros 413/415/422 (UploadError com mensagem amigável).
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

const photo: LocalPhotoAsset = {
    uri: 'file:///photo.jpg',
    name: 'photo.jpg',
    mime: 'image/jpeg',
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
    mockPost.mockResolvedValue({ data: { url: 'https://cdn/aems/photo.jpg' } });
});

describe('uploadPhoto — request', () => {
    it('envia FormData no endpoint correto, com header multipart e timeout 120s', async () => {
        await uploadPhoto(photo);

        expect(mockPost).toHaveBeenCalledTimes(1);
        const [url, body, config] = mockPost.mock.calls[0];
        expect(url).toBe('/upload/photo');
        expect(body).toBeInstanceOf(FormData);
        expect(config.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
        expect(config.timeout).toBe(120_000);
    });

    it('o FormData contém o campo `file`', async () => {
        await uploadPhoto(photo);
        const body = mockPost.mock.calls[0][1] as FormData;
        // O shape interno do entry depende da implementação de FormData do
        // ambiente (RN preserva o objeto {uri,name,type}; jsdom coage a string).
        // Aqui basta garantir que o campo `file` foi anexado.
        expect(body.has('file')).toBe(true);
    });

    it('retorna a url da resposta', async () => {
        const url = await uploadPhoto(photo);
        expect(url).toBe('https://cdn/aems/photo.jpg');
    });
});

describe('uploadPhoto — progresso', () => {
    it('repassa onProgress a partir de onUploadProgress (0-100)', async () => {
        mockPost.mockImplementationOnce(async (_url, _body, config) => {
            config.onUploadProgress({ loaded: 50, total: 200 });
            config.onUploadProgress({ loaded: 200, total: 200 });
            return { data: { url: 'https://cdn/x.jpg' } };
        });

        const progress: number[] = [];
        await uploadPhoto(photo, (p) => progress.push(p));
        expect(progress).toEqual([25, 100]);
    });

    it('ignora eventos sem total (não chama onProgress)', async () => {
        mockPost.mockImplementationOnce(async (_url, _body, config) => {
            config.onUploadProgress({ loaded: 10, total: 0 });
            return { data: { url: 'https://cdn/x.jpg' } };
        });
        const onProgress = jest.fn();
        await uploadPhoto(photo, onProgress);
        expect(onProgress).not.toHaveBeenCalled();
    });
});

describe('uploadPhoto — erros', () => {
    it('resposta sem url lança UploadError', async () => {
        mockPost.mockResolvedValueOnce({ data: {} });
        await expect(uploadPhoto(photo)).rejects.toBeInstanceOf(UploadError);
    });

    it('413 → mensagem de imagem muito grande', async () => {
        mockPost.mockRejectedValueOnce(axiosError(413));
        await expect(uploadPhoto(photo)).rejects.toMatchObject({
            name: 'UploadError',
            status: 413,
            message: expect.stringContaining('10 MB'),
        });
    });

    it('415 → mensagem de formato não suportado', async () => {
        mockPost.mockRejectedValueOnce(axiosError(415));
        await expect(uploadPhoto(photo)).rejects.toMatchObject({
            status: 415,
            message: expect.stringContaining('não suportado'),
        });
    });

    it('422 → mensagem de imagem não processável', async () => {
        mockPost.mockRejectedValueOnce(axiosError(422));
        await expect(uploadPhoto(photo)).rejects.toMatchObject({
            status: 422,
            message: expect.stringContaining('não pôde ser processada'),
        });
    });

    it('erro genérico (500) cai no fallback amigável', async () => {
        mockPost.mockRejectedValueOnce(axiosError(500, { detail: 'boom' }));
        const err = (await uploadPhoto(photo).catch((e) => e)) as UploadError;
        expect(err).toBeInstanceOf(UploadError);
        expect(err.status).toBe(500);
        // detail string do FastAPI é repassado por getApiErrorMessage.
        expect(err.message).toBe('boom');
    });
});
