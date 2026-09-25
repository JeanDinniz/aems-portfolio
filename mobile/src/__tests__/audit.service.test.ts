import { auditService } from '@/services/api/audit.service';

/**
 * Auditoria (Owner-only, READ-ONLY): auditService.list.
 * Valida o endpoint `/audit-logs` e a limpeza dos filtros vazios (undefined/''/
 * null são removidos antes de virar query params). O apiClient é mockado.
 */
const mockGet = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
    },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: { items: [], pagination: {} } });
});

describe('auditService.list', () => {
    it('faz GET /audit-logs e retorna a resposta paginada', async () => {
        const payload = {
            items: [{ id: 1, action: 'login', resource_type: 'auth' }],
            pagination: { page: 1, limit: 50, total: 1, total_pages: 1, has_next: false, has_prev: false },
        };
        mockGet.mockResolvedValueOnce({ data: payload });

        const res = await auditService.list({ page: 1, limit: 50 });

        expect(mockGet).toHaveBeenCalledWith('/audit-logs', {
            params: { page: 1, limit: 50 },
        });
        expect(res).toEqual(payload);
    });

    it('remove filtros vazios (undefined, string vazia, null)', async () => {
        await auditService.list({
            action: 'update',
            resource_type: '',
            user_name: undefined,
            resource_id: undefined,
            start_date: '2026-07-01T00:00:00.000Z',
            end_date: '',
            page: 2,
            limit: 50,
        });

        expect(mockGet).toHaveBeenCalledWith('/audit-logs', {
            params: {
                action: 'update',
                start_date: '2026-07-01T00:00:00.000Z',
                page: 2,
                limit: 50,
            },
        });
    });

    it('usa objeto vazio como default (sem params)', async () => {
        await auditService.list();
        expect(mockGet).toHaveBeenCalledWith('/audit-logs', { params: {} });
    });
});
