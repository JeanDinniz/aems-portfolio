import { employeesService } from '@/services/api/employees.service';

/**
 * Admin — Fatia 5a: métodos estendidos de employeesService (getById/getStats/
 * listMovements). Valida a construção de URL/params de cada chamada. O apiClient
 * é mockado (named export `{ apiClient }`); capturamos os args.
 */
const mockGet = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
    },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: {} });
});

describe('employeesService.list — filtros (loja/status/departamento)', () => {
    beforeEach(() => {
        mockGet.mockResolvedValue({ data: { items: [], pagination: { total: 0 } } });
    });

    it('encaminha store_id, hr_status e department na querystring', async () => {
        await employeesService.list(
            { store_id: 3, hr_status: 'away', department: 'film', search: 'ana' },
            1,
            200
        );
        const url = mockGet.mock.calls[0][0] as string;
        expect(url).toContain('store_id=3');
        expect(url).toContain('hr_status=away');
        expect(url).toContain('department=film');
        expect(url).toContain('search=ana');
        expect(url).toContain('page=1');
        expect(url).toContain('limit=200');
    });

    it('sem status não envia hr_status nem is_active (Todos)', async () => {
        await employeesService.list({ store_id: 3 }, 1, 200);
        const url = mockGet.mock.calls[0][0] as string;
        expect(url).not.toContain('hr_status=');
        expect(url).not.toContain('is_active=');
    });

    it('is_active=false é encaminhado quando informado', async () => {
        await employeesService.list({ is_active: false }, 1, 200);
        const url = mockGet.mock.calls[0][0] as string;
        expect(url).toContain('is_active=false');
    });
});

describe('employeesService.getById', () => {
    it('busca a ficha em /employees/{id}', async () => {
        mockGet.mockResolvedValueOnce({ data: { id: 7, name: 'Ana' } });
        const res = await employeesService.getById(7);
        expect(mockGet).toHaveBeenCalledWith('/employees/7');
        expect(res).toEqual({ id: 7, name: 'Ana' });
    });
});

describe('employeesService.getStats', () => {
    it('inclui store_id quando informado', async () => {
        mockGet.mockResolvedValueOnce({
            data: { total: 10, active: 8, away: 1, dismissed: 1, vacations_planned: 0 },
        });
        await employeesService.getStats(3);
        expect(mockGet).toHaveBeenCalledWith('/employees/stats', { params: { store_id: 3 } });
    });

    it('sem store_id envia params vazio (todas as lojas)', async () => {
        await employeesService.getStats();
        expect(mockGet).toHaveBeenCalledWith('/employees/stats', { params: {} });
    });
});

describe('employeesService.listMovements', () => {
    it('pagina em /employees/{id}/movements', async () => {
        mockGet.mockResolvedValueOnce({
            data: { items: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 } },
        });
        await employeesService.listMovements(5, 2);
        expect(mockGet).toHaveBeenCalledWith('/employees/5/movements', {
            params: { page: 2, limit: 20 },
        });
    });

    it('usa page=1 por padrão', async () => {
        await employeesService.listMovements(5);
        expect(mockGet).toHaveBeenCalledWith('/employees/5/movements', {
            params: { page: 1, limit: 20 },
        });
    });
});
