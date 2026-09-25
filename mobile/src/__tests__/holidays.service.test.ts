import { holidaysService } from '@/services/api/holidays.service';

/**
 * Feriados — holidaysService (camada de dados). Testa a construção de
 * URL/params/body de cada método, com destaque para o caso `clear_store` do
 * update (mudar de loja específica para "todas").
 *
 * O apiClient é mockado (named export `{ apiClient }`); capturamos os args.
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

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: { items: [], pagination: { total: 0 } } });
    mockPost.mockResolvedValue({ data: { id: 1 } });
    mockPatch.mockResolvedValue({ data: { id: 1 } });
    mockDelete.mockResolvedValue({ data: {} });
});

describe('holidaysService.list', () => {
    it('passa page/limit/year/store_id como params e retorna items+pagination', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [{ id: 1, date: '2026-01-01', name: 'Ano Novo' }],
                pagination: { total: 1 },
            },
        });
        const res = await holidaysService.list({ year: 2026, limit: 100, page: 1, store_id: 3 });
        expect(mockGet).toHaveBeenCalledWith('/holidays', {
            params: { year: 2026, limit: 100, page: 1, store_id: 3 },
        });
        expect(res.items).toHaveLength(1);
        expect(res.pagination.total).toBe(1);
    });

    it('sem argumentos passa params=undefined', async () => {
        await holidaysService.list();
        expect(mockGet).toHaveBeenCalledWith('/holidays', { params: undefined });
    });
});

describe('holidaysService.getById', () => {
    it('faz GET /holidays/{id} e retorna o feriado', async () => {
        mockGet.mockResolvedValueOnce({ data: { id: 7, name: 'Carnaval' } });
        const res = await holidaysService.getById(7);
        expect(mockGet).toHaveBeenCalledWith('/holidays/7');
        expect(res).toEqual({ id: 7, name: 'Carnaval' });
    });
});

describe('holidaysService.create', () => {
    it('faz POST /holidays com o payload (loja específica)', async () => {
        mockPost.mockResolvedValueOnce({ data: { id: 9 } });
        const res = await holidaysService.create({
            date: '2026-04-21',
            name: 'Tiradentes',
            store_id: 2,
        });
        expect(mockPost).toHaveBeenCalledWith('/holidays', {
            date: '2026-04-21',
            name: 'Tiradentes',
            store_id: 2,
        });
        expect(res).toEqual({ id: 9 });
    });

    it('aceita store_id null (todas as lojas)', async () => {
        await holidaysService.create({ date: '2026-12-25', name: 'Natal', store_id: null });
        expect(mockPost).toHaveBeenCalledWith('/holidays', {
            date: '2026-12-25',
            name: 'Natal',
            store_id: null,
        });
    });
});

describe('holidaysService.update', () => {
    it('faz PATCH /holidays/{id} com payload parcial', async () => {
        await holidaysService.update(5, { name: 'Novo nome', store_id: 4 });
        expect(mockPatch).toHaveBeenCalledWith('/holidays/5', {
            name: 'Novo nome',
            store_id: 4,
        });
    });

    it('ao passar para "todas as lojas" manda store_id=null E clear_store=true', async () => {
        await holidaysService.update(5, {
            date: '2026-01-01',
            name: 'Ano Novo',
            store_id: null,
            clear_store: true,
        });
        expect(mockPatch).toHaveBeenCalledWith('/holidays/5', {
            date: '2026-01-01',
            name: 'Ano Novo',
            store_id: null,
            clear_store: true,
        });
    });
});

describe('holidaysService.remove', () => {
    it('faz DELETE /holidays/{id} e resolve undefined', async () => {
        const res = await holidaysService.remove(5);
        expect(mockDelete).toHaveBeenCalledWith('/holidays/5');
        expect(res).toBeUndefined();
    });
});
