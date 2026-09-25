import { installerPerformanceService } from '@/services/api/installer-performance.service';

/**
 * Desempenho de Instaladores — camada de dados.
 * Verifica path + params (incluindo serialização de `employee_ids` como chaves
 * repetidas via `paramsSerializer: { indexes: null }`) e que store_id/employee_ids
 * só entram quando presentes.
 *
 * apiClient é mockado (named export `{ apiClient }`); capturamos os args do get.
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

describe('installerPerformanceService.getDaily', () => {
    it('GET /installer-performance/daily só com date quando sem loja/instaladores', async () => {
        await installerPerformanceService.getDaily({ date: '2026-07-20' });
        expect(mockGet).toHaveBeenCalledWith('/installer-performance/daily', {
            params: { date: '2026-07-20' },
            paramsSerializer: { indexes: null },
        });
    });

    it('inclui store_id e employee_ids quando presentes', async () => {
        await installerPerformanceService.getDaily({
            date: '2026-07-20',
            store_id: 3,
            employee_ids: [1, 2],
        });
        expect(mockGet).toHaveBeenCalledWith('/installer-performance/daily', {
            params: { date: '2026-07-20', store_id: 3, employee_ids: [1, 2] },
            paramsSerializer: { indexes: null },
        });
    });

    it('omite employee_ids quando array vazio', async () => {
        await installerPerformanceService.getDaily({ date: '2026-07-20', employee_ids: [] });
        const call = mockGet.mock.calls[0][1];
        expect(call.params).not.toHaveProperty('employee_ids');
    });

    it('retorna response.data', async () => {
        mockGet.mockResolvedValueOnce({ data: { grand_total_cars: 5, groups: [] } });
        const res = await installerPerformanceService.getDaily({ date: '2026-07-20' });
        expect(res).toEqual({ grand_total_cars: 5, groups: [] });
    });
});

describe('installerPerformanceService.getIndividual', () => {
    it('GET /installer-performance/individual com start/end/employee_id', async () => {
        await installerPerformanceService.getIndividual({
            start: '2026-07-01',
            end: '2026-07-20',
            employee_id: 9,
        });
        expect(mockGet).toHaveBeenCalledWith('/installer-performance/individual', {
            params: { start: '2026-07-01', end: '2026-07-20', employee_id: 9 },
        });
    });

    it('inclui store_id quando presente', async () => {
        await installerPerformanceService.getIndividual({
            start: '2026-07-01',
            end: '2026-07-20',
            employee_id: 9,
            store_id: 3,
        });
        const call = mockGet.mock.calls[0][1];
        expect(call.params.store_id).toBe(3);
    });
});
