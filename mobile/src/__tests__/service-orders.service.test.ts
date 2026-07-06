import { serviceOrdersService } from '@/services/api/service-orders.service';

/**
 * OS-01 — serviceOrdersService (lógica reaproveitada do web).
 * Testa: construção de query params, mapeamento de status (in_progress↔doing,
 * completed↔ready), parseJson de fotos, e o mapServiceOrder (placa/loja/workers/items).
 *
 * O apiClient é mockado (named export `{ apiClient }`). Capturamos a URL/payload
 * de cada chamada para inspecionar os params construídos pelo service.
 */
const mockGet = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        patch: (...args: unknown[]) => mockPatch(...args),
        post: jest.fn(),
        delete: jest.fn(),
    },
}));

/** Resposta paginada vazia padrão (1 item base, sobrescrevível). */
function pageResponse(items: unknown[] = []) {
    return { data: { items, pagination: { total: items.length } } };
}

/** Extrai a query string (após `?`) da última URL passada ao apiClient.get. */
function lastGetQuery(): URLSearchParams {
    const url = mockGet.mock.calls[mockGet.mock.calls.length - 1][0] as string;
    const qs = url.split('?')[1] ?? '';
    return new URLSearchParams(qs);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(pageResponse());
    mockPatch.mockResolvedValue({ data: { id: 1, status: 'in_progress' } });
});

describe('serviceOrdersService.getAll — construção de query params', () => {
    it('status único e múltiplos viram params `status` repetidos', async () => {
        await serviceOrdersService.getAll({ status: ['waiting', 'in_progress'] });
        const q = lastGetQuery();
        expect(q.getAll('status')).toEqual(['waiting', 'in_progress']);

        await serviceOrdersService.getAll({ status: 'waiting' });
        expect(lastGetQuery().getAll('status')).toEqual(['waiting']);
    });

    it('location_id e store_id ambos mapeiam para `store_id`', async () => {
        await serviceOrdersService.getAll({ location_id: 7 });
        expect(lastGetQuery().get('store_id')).toBe('7');

        await serviceOrdersService.getAll({ store_id: 9 });
        expect(lastGetQuery().get('store_id')).toBe('9');
    });

    it('search vira `plate`; datas viram date_from/date_to', async () => {
        await serviceOrdersService.getAll({
            search: 'ABC1D23',
            date_from: '2026-01-01',
            date_to: '2026-01-31',
        });
        const q = lastGetQuery();
        expect(q.get('plate')).toBe('ABC1D23');
        expect(q.get('date_from')).toBe('2026-01-01');
        expect(q.get('date_to')).toBe('2026-01-31');
    });

    it('start_date/end_date também viram date_from/date_to', async () => {
        await serviceOrdersService.getAll({ start_date: '2026-02-01', end_date: '2026-02-28' });
        const q = lastGetQuery();
        expect(q.get('date_from')).toBe('2026-02-01');
        expect(q.get('date_to')).toBe('2026-02-28');
    });

    it('flag (array) vira múltiplos params `flag`', async () => {
        await serviceOrdersService.getAll({ flag: ['galpon', 'return'] });
        expect(lastGetQuery().getAll('flag')).toEqual(['galpon', 'return']);
    });

    it('page é derivado de skip/limit (1-indexed) e limit é repassado', async () => {
        await serviceOrdersService.getAll(undefined, 0, 20);
        expect(lastGetQuery().get('page')).toBe('1');

        await serviceOrdersService.getAll(undefined, 40, 20);
        const q = lastGetQuery();
        expect(q.get('page')).toBe('3'); // floor(40/20)+1
        expect(q.get('limit')).toBe('20');
    });

    it('is_verified=false é enviado (cobre o `!== undefined`)', async () => {
        await serviceOrdersService.getAll({ is_verified: false });
        expect(lastGetQuery().get('is_verified')).toBe('false');
    });

    it('retorna { items, total } a partir de pagination.total', async () => {
        mockGet.mockResolvedValueOnce({
            data: { items: [{ id: 1, status: 'waiting' }], pagination: { total: 57 } },
        });
        const result = await serviceOrdersService.getAll();
        expect(result.total).toBe(57);
        expect(result.items).toHaveLength(1);
    });
});

describe('serviceOrdersService — mapeamento de status backend↔frontend', () => {
    it('getAll converte in_progress→doing e completed→ready', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [
                    { id: 1, status: 'in_progress' },
                    { id: 2, status: 'completed' },
                    { id: 3, status: 'waiting' },
                ],
                pagination: { total: 3 },
            },
        });
        const { items } = await serviceOrdersService.getAll();
        expect(items.map((i) => i.status)).toEqual(['doing', 'ready', 'waiting']);
    });

    it('updateStatus converte doing→in_progress e ready→completed no payload', async () => {
        await serviceOrdersService.updateStatus(1, 'doing');
        expect(mockPatch).toHaveBeenLastCalledWith(
            '/service-orders/1/status',
            expect.objectContaining({ new_status: 'in_progress' })
        );

        await serviceOrdersService.updateStatus(1, 'ready', { reason: 'x' });
        expect(mockPatch).toHaveBeenLastCalledWith(
            '/service-orders/1/status',
            expect.objectContaining({ new_status: 'completed', reason: 'x' })
        );
    });

    it('updateStatus mantém status alternativos (wrong/cancelled) sem conversão', async () => {
        await serviceOrdersService.updateStatus(1, 'wrong');
        expect(mockPatch).toHaveBeenLastCalledWith(
            '/service-orders/1/status',
            expect.objectContaining({ new_status: 'wrong' })
        );
    });
});

describe('serviceOrdersService — parseJson de fotos', () => {
    it('aceita photos/damage_photos como string JSON', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [
                    {
                        id: 1,
                        status: 'waiting',
                        photos: '["a.jpg","b.jpg"]',
                        damage_photos: '["d.jpg"]',
                    },
                ],
                pagination: { total: 1 },
            },
        });
        const { items } = await serviceOrdersService.getAll();
        expect(items[0].photos).toEqual(['a.jpg', 'b.jpg']);
        expect(items[0].damage_photos).toEqual(['d.jpg']);
    });

    it('aceita photos já como array', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [{ id: 1, status: 'waiting', photos: ['x.jpg'], damage_photos: ['y.jpg'] }],
                pagination: { total: 1 },
            },
        });
        const { items } = await serviceOrdersService.getAll();
        expect(items[0].photos).toEqual(['x.jpg']);
        expect(items[0].damage_photos).toEqual(['y.jpg']);
    });

    it('JSON inválido cai no fallback (array vazio)', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [{ id: 1, status: 'waiting', photos: 'not-json', damage_photos: null }],
                pagination: { total: 1 },
            },
        });
        const { items } = await serviceOrdersService.getAll();
        expect(items[0].photos).toEqual([]);
        expect(items[0].damage_photos).toEqual([]);
    });
});

describe('serviceOrdersService — mapServiceOrder (campos derivados)', () => {
    it('placa vem de vehicle_plate, com fallback para plate', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [
                    { id: 1, status: 'waiting', vehicle_plate: 'AAA1A11' },
                    { id: 2, status: 'waiting', plate: 'BBB2B22' },
                    { id: 3, status: 'waiting' },
                ],
                pagination: { total: 3 },
            },
        });
        const { items } = await serviceOrdersService.getAll();
        expect(items.map((i) => i.plate)).toEqual(['AAA1A11', 'BBB2B22', '']);
    });

    it('loja vem de store_id/store_name; order_number tem fallback #id', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [{ id: 42, status: 'waiting', store_id: 5, store_name: 'Loja Centro' }],
                pagination: { total: 1 },
            },
        });
        const { items } = await serviceOrdersService.getAll();
        expect(items[0].location_id).toBe(5);
        expect(items[0].location_name).toBe('Loja Centro');
        expect(items[0].order_number).toBe('#42');
    });

    it('workers e items são mapeados (primeiro worker = isPrimary, technician derivado)', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [
                    {
                        id: 1,
                        status: 'waiting',
                        workers: [
                            { id: 10, employee_id: 10, employee_name: 'João' },
                            { id: 11, employee_id: 11, employee_name: 'Maria' },
                        ],
                        items: [{ service_id: 3, quantity: 2, unit_price: 50 }],
                    },
                ],
                pagination: { total: 1 },
            },
        });
        const { items } = await serviceOrdersService.getAll();
        const os = items[0];
        expect(os.workers).toHaveLength(2);
        expect(os.workers?.[0]).toMatchObject({ employee_id: 10, name: 'João', isPrimary: true });
        expect(os.workers?.[1].isPrimary).toBe(false);
        expect(os.technician_id).toBe(10);
        expect(os.technician_name).toBe('João');
        expect(os.items?.[0]).toMatchObject({ service_id: 3, quantity: 2, unit_price: 50 });
    });
});
