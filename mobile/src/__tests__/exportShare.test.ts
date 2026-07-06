import { downloadAndShareExcel } from '@/utils/exportShare';
import * as Sharing from 'expo-sharing';

/**
 * Sprint 6 — Fatia 4: downloadAndShareExcel.
 *
 * Mocka apiClient.get, expo-sharing (jest.setup) e expo-file-system (jest.setup).
 * Valida: baixa com responseType 'arraybuffer', grava o arquivo em cache (base64)
 * e abre o compartilhamento nativo; e lança erro quando isAvailableAsync → false.
 */
declare const global: {
    mockSharing: { available: boolean };
    mockFileWrites: { uri: string; content: string; options?: { encoding?: string } }[];
    mockFileSystemFiles: Set<string>;
};

const mockGet = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        post: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

/** ArrayBuffer pequeno e determinístico ("AEMS"). */
function sampleBuffer(): ArrayBuffer {
    return Uint8Array.from([65, 69, 77, 83]).buffer;
}

beforeEach(() => {
    jest.clearAllMocks();
    global.mockSharing.available = true;
    global.mockFileWrites = [];
    global.mockFileSystemFiles = new Set();
    mockGet.mockResolvedValue({ data: sampleBuffer() });
});

describe('downloadAndShareExcel', () => {
    it('baixa com responseType arraybuffer e repassa path/params', async () => {
        await downloadAndShareExcel({
            path: '/service-orders/export/conferencia',
            params: { store_id: 7, flag: ['courtesy'] },
            filename: 'conferencia_x.xlsx',
        });

        expect(mockGet).toHaveBeenCalledTimes(1);
        const [path, config] = mockGet.mock.calls[0];
        expect(path).toBe('/service-orders/export/conferencia');
        expect(config.responseType).toBe('arraybuffer');
        expect(config.params).toEqual({ store_id: 7, flag: ['courtesy'] });
        // Arrays serializados como chaves repetidas (flag=a&flag=b).
        expect(config.paramsSerializer).toEqual({ indexes: null });
    });

    it('grava o arquivo no cache em base64 e abre o compartilhamento', async () => {
        await downloadAndShareExcel({
            path: '/service-orders/export/conferencia',
            params: {},
            filename: 'conferencia_x.xlsx',
        });

        // Escreveu o .xlsx em base64.
        expect(global.mockFileWrites).toHaveLength(1);
        const write = global.mockFileWrites[0];
        expect(write.uri).toContain('conferencia_x.xlsx');
        expect(write.options).toEqual({ encoding: 'base64' });
        // "AEMS" em base64.
        expect(write.content).toBe('QUVNUw==');

        // Compartilhou o arquivo gravado com mime/UTI de planilha.
        expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
        const [uri, opts] = (Sharing.shareAsync as jest.Mock).mock.calls[0];
        expect(uri).toContain('conferencia_x.xlsx');
        expect(opts.mimeType).toBe(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        expect(opts.UTI).toBe('org.openxmlformats.spreadsheetml.sheet');
        expect(opts.dialogTitle).toBe('conferencia_x.xlsx');
    });

    it('lança erro amigável quando o compartilhamento é indisponível', async () => {
        global.mockSharing.available = false;

        await expect(
            downloadAndShareExcel({
                path: '/service-orders/export/conferencia',
                filename: 'conferencia_x.xlsx',
            })
        ).rejects.toThrow('Compartilhamento indisponível');

        // Não deve baixar nem compartilhar se indisponível.
        expect(mockGet).not.toHaveBeenCalled();
        expect(Sharing.shareAsync).not.toHaveBeenCalled();
    });
});
