import { analyticsService } from '@/services/api/analytics.service';
import type { DashboardParams } from '@/services/api/analytics.service';

/**
 * Dashboard 3a — analyticsService (camada de dados do Dashboard executivo).
 * Verifica, para cada método, que o path é o correto e que os params são
 * repassados ao apiClient.get (incluindo department/limit/granularity onde
 * aplica). Destaque: getQueue não tem período — só store_id opcional.
 *
 * apiClient é mockado (named export `{ apiClient }`); capturamos os args do get.
 */
const mockGet = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
    },
}));

const PARAMS: DashboardParams = {
    start_date: '2026-06-01',
    end_date: '2026-06-30',
    store_id: 3,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: [] });
});

describe('analyticsService — endpoints com período', () => {
    it('getOverview → GET /analytics/dashboard/overview com params', async () => {
        mockGet.mockResolvedValueOnce({ data: { revenue: { current: 10 } } });
        const res = await analyticsService.getOverview(PARAMS);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/overview', {
            params: PARAMS,
        });
        expect(res).toEqual({ revenue: { current: 10 } });
    });

    it('getStoresRanking → GET /analytics/dashboard/stores', async () => {
        await analyticsService.getStoresRanking(PARAMS);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/stores', {
            params: PARAMS,
        });
    });

    it('getDepartmentBreakdown → GET /analytics/dashboard/departments', async () => {
        await analyticsService.getDepartmentBreakdown(PARAMS);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/departments', {
            params: PARAMS,
        });
    });

    it('getSla → GET /analytics/dashboard/sla', async () => {
        await analyticsService.getSla(PARAMS);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/sla', { params: PARAMS });
    });

    it('getFilmPpfRanking → GET /analytics/dashboard/film-ppf-ranking', async () => {
        await analyticsService.getFilmPpfRanking(PARAMS);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/film-ppf-ranking', {
            params: PARAMS,
        });
    });
});

describe('analyticsService — rankings com department/limit', () => {
    it('getServicesRanking repassa department e limit nos params', async () => {
        const p = { ...PARAMS, department: 'film', limit: 10 };
        await analyticsService.getServicesRanking(p);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/services', { params: p });
    });

    it('getEmployeesRanking repassa department e limit nos params', async () => {
        const p = { ...PARAMS, department: 'ppf', limit: 5 };
        await analyticsService.getEmployeesRanking(p);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/employees', { params: p });
    });

    it('getConsultantsRanking repassa limit nos params', async () => {
        const p = { ...PARAMS, limit: 10 };
        await analyticsService.getConsultantsRanking(p);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/consultants', { params: p });
    });
});

describe('analyticsService — timeseries com granularity', () => {
    it('getTimeseries repassa granularity nos params', async () => {
        const p = { ...PARAMS, granularity: 'day' as const };
        await analyticsService.getTimeseries(p);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/timeseries', { params: p });
    });

    it('getTimeseriesByType → GET /analytics/dashboard/timeseries-by-type com granularity', async () => {
        const p = { ...PARAMS, granularity: 'month' as const };
        await analyticsService.getTimeseriesByType(p);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/timeseries-by-type', {
            params: p,
        });
    });
});

describe('analyticsService.getQueue — snapshot ao vivo (sem período)', () => {
    it('com store_id manda apenas { store_id } nos params', async () => {
        mockGet.mockResolvedValueOnce({ data: [{ store_id: 7, store_name: 'Loja' }] });
        const res = await analyticsService.getQueue(7);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/queue', {
            params: { store_id: 7 },
        });
        expect(res).toEqual([{ store_id: 7, store_name: 'Loja' }]);
    });

    it('sem store_id manda params vazios (todas as lojas)', async () => {
        await analyticsService.getQueue();
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/queue', { params: {} });
    });

    it('store_id 0 (falsy) não é enviado', async () => {
        await analyticsService.getQueue(0);
        expect(mockGet).toHaveBeenCalledWith('/analytics/dashboard/queue', { params: {} });
    });
});
