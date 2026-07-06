import { schedulingService } from '@/services/api/scheduling.service';

/**
 * AGD-01 — schedulingService (camada de dados reaproveitada do web).
 * Testa a construção de params/body de cada método e o formato de retorno.
 * O apiClient é mockado (named export `{ apiClient }`); capturamos os args de
 * cada chamada para inspecionar params/body construídos pelo service.
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        post: (...args: unknown[]) => mockPost(...args),
        patch: (...args: unknown[]) => mockPatch(...args),
        delete: (...args: unknown[]) => mockDelete(...args),
    },
}));

/** Config (2º arg) da última chamada de um mock get/delete. */
function lastConfig(mock: jest.Mock): Record<string, unknown> {
    const call = mock.mock.calls[mock.mock.calls.length - 1];
    return (call?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: { items: [], pagination: { total: 0 } } });
    mockPost.mockResolvedValue({ data: {} });
    mockPatch.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: {} });
});

describe('schedulingService.list', () => {
    it('envia page/limit e só os filtros preenchidos (service_category → category)', async () => {
        await schedulingService.list(
            {
                store_id: 5,
                department: 'film',
                service_category: 'pelicula',
                date_from: '2026-06-01',
                date_to: '2026-06-30',
                search: 'ABC1D23',
                include_cancelled: true,
            },
            2,
            25
        );
        const { params } = lastConfig(mockGet) as { params: Record<string, unknown> };
        expect(mockGet).toHaveBeenCalledWith('/scheduling', expect.anything());
        expect(params).toMatchObject({
            page: 2,
            limit: 25,
            store_id: 5,
            department: 'film',
            category: 'pelicula',
            date_from: '2026-06-01',
            date_to: '2026-06-30',
            search: 'ABC1D23',
            include_cancelled: true,
        });
    });

    it('omite filtros vazios e usa page/limit padrão', async () => {
        await schedulingService.list();
        const { params } = lastConfig(mockGet) as { params: Record<string, unknown> };
        expect(params).toEqual({ page: 1, limit: 50 });
        expect(params).not.toHaveProperty('store_id');
        expect(params).not.toHaveProperty('include_cancelled');
    });

    it('retorna { items, pagination } da resposta', async () => {
        mockGet.mockResolvedValueOnce({
            data: { items: [{ id: 1 }], pagination: { total: 1, page: 1, limit: 50, pages: 1 } },
        });
        const res = await schedulingService.list();
        expect(res.items).toHaveLength(1);
        expect(res.pagination.total).toBe(1);
    });
});

describe('schedulingService — summaries', () => {
    it('getTodaySummary envia store_id quando informado, vazio quando null', async () => {
        await schedulingService.getTodaySummary(7);
        expect((lastConfig(mockGet) as { params: unknown }).params).toEqual({ store_id: 7 });

        await schedulingService.getTodaySummary(null);
        expect((lastConfig(mockGet) as { params: unknown }).params).toEqual({});
    });

    it('getStoreSummary repassa só filtros preenchidos', async () => {
        await schedulingService.getStoreSummary({ date_from: '2026-06-01', department: 'film' });
        const { params } = lastConfig(mockGet) as { params: Record<string, unknown> };
        expect(params).toEqual({ date_from: '2026-06-01', department: 'film' });
    });
});

describe('schedulingService.getCapacity', () => {
    it('envia store_id/delivery_date e extrai count do payload', async () => {
        mockGet.mockResolvedValueOnce({ data: { count: 4 } });
        const result = await schedulingService.getCapacity(3, '2026-06-21');
        expect(mockGet).toHaveBeenCalledWith('/scheduling/capacity', {
            params: { store_id: 3, delivery_date: '2026-06-21' },
        });
        expect(result).toBe(4);
    });
});

describe('schedulingService.cancel', () => {
    it('manda cancellation_reason no body do DELETE', async () => {
        await schedulingService.cancel(9, 'cliente desistiu');
        expect(mockDelete).toHaveBeenCalledWith('/scheduling/9', {
            data: { cancellation_reason: 'cliente desistiu' },
        });
    });

    it('envia cancellation_reason null quando sem motivo', async () => {
        await schedulingService.cancel(9);
        expect(mockDelete).toHaveBeenCalledWith('/scheduling/9', {
            data: { cancellation_reason: null },
        });
    });
});

describe('schedulingService — create/update/history/generateOS', () => {
    it('create faz POST /scheduling com o payload', async () => {
        const payload = { store_id: 1, department: 'film', delivery_date: '2026-06-21', vehicle_plate: 'ABC1D23' };
        await schedulingService.create(payload);
        expect(mockPost).toHaveBeenCalledWith('/scheduling', payload);
    });

    it('update faz PATCH /scheduling/{id} com o payload parcial', async () => {
        await schedulingService.update(5, { notes: 'obs' });
        expect(mockPatch).toHaveBeenCalledWith('/scheduling/5', { notes: 'obs' });
    });

    it('getHistory faz GET /scheduling/{id}/history', async () => {
        mockGet.mockResolvedValueOnce({ data: { items: [] } });
        await schedulingService.getHistory(8);
        expect(mockGet).toHaveBeenCalledWith('/scheduling/8/history');
    });

    it('generateOS faz POST e retorna service_order_id/order_number', async () => {
        mockPost.mockResolvedValueOnce({
            data: { service_order_id: 42, order_number: 'OS-0042' },
        });
        const result = await schedulingService.generateOS(8, { photos: ['a.jpg'], notes: 'x' });
        expect(mockPost).toHaveBeenCalledWith('/scheduling/8/generate-os', {
            photos: ['a.jpg'],
            notes: 'x',
        });
        expect(result).toEqual({ service_order_id: 42, order_number: 'OS-0042' });
    });
});
