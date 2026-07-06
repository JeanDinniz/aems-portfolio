import { brandsService } from '@/services/api/brands.service';
import { vehicleModelsService } from '@/services/api/vehicle-models.service';
import { servicesService } from '@/services/api/services.service';
import { suppliersService } from '@/services/api/suppliers.service';
import { dealershipsService } from '@/services/api/dealerships.service';

/**
 * Admin — Fatia 5b: métodos activate/deactivate dos catálogos + dealerships.service
 * novo. Valida método HTTP, path e params (com destaque para o `brand_id` que as
 * rotas de vehicle-models EXIGEM). O apiClient é mockado; capturamos os args.
 */
const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        patch: (...args: unknown[]) => mockPatch(...args),
        delete: (...args: unknown[]) => mockDelete(...args),
    },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: {} });
    mockPatch.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: {} });
});

describe('brandsService', () => {
    it('deactivate → DELETE /brands/{id}', async () => {
        mockDelete.mockResolvedValueOnce({ data: { id: 5, is_active: false } });
        const res = await brandsService.deactivate(5);
        expect(mockDelete).toHaveBeenCalledWith('/brands/5');
        expect(res).toEqual({ id: 5, is_active: false });
    });

    it('activate → PATCH /brands/{id} { is_active: true }', async () => {
        await brandsService.activate(5);
        expect(mockPatch).toHaveBeenCalledWith('/brands/5', { is_active: true });
    });
});

describe('vehicleModelsService', () => {
    it('deactivate → DELETE /vehicle-models/{id} com brand_id na query', async () => {
        await vehicleModelsService.deactivate(9, 3);
        expect(mockDelete).toHaveBeenCalledWith('/vehicle-models/9', {
            params: { brand_id: 3 },
        });
    });

    it('activate → PATCH /vehicle-models/{id} { is_active: true } com brand_id na query', async () => {
        await vehicleModelsService.activate(9, 3);
        expect(mockPatch).toHaveBeenCalledWith(
            '/vehicle-models/9',
            { is_active: true },
            { params: { brand_id: 3 } }
        );
    });
});

describe('servicesService', () => {
    it('getById → GET /services/{id}', async () => {
        await servicesService.getById(12);
        expect(mockGet).toHaveBeenCalledWith('/services/12');
    });

    it('deactivate → DELETE /services/{id}', async () => {
        await servicesService.deactivate(12);
        expect(mockDelete).toHaveBeenCalledWith('/services/12');
    });

    it('activate → PATCH /services/{id} { is_active: true }', async () => {
        await servicesService.activate(12);
        expect(mockPatch).toHaveBeenCalledWith('/services/12', { is_active: true });
    });
});

describe('suppliersService', () => {
    it('getById → GET /suppliers/{id}', async () => {
        await suppliersService.getById(4);
        expect(mockGet).toHaveBeenCalledWith('/suppliers/4');
    });

    it('deactivate → DELETE /suppliers/{id}', async () => {
        await suppliersService.deactivate(4);
        expect(mockDelete).toHaveBeenCalledWith('/suppliers/4');
    });

    it('activate → PATCH /suppliers/{id} { is_active: true }', async () => {
        await suppliersService.activate(4);
        expect(mockPatch).toHaveBeenCalledWith('/suppliers/4', { is_active: true });
    });
});

describe('dealershipsService', () => {
    it('list → GET /dealerships com page/limit e filtros aplicados', async () => {
        mockGet.mockResolvedValueOnce({ data: { items: [{ id: 1 }], total: 1 } });
        const res = await dealershipsService.list({ store_id: 2, is_active: true });
        expect(mockGet).toHaveBeenCalledWith('/dealerships', {
            params: { page: 1, limit: 200, store_id: 2, is_active: true },
        });
        expect(res.items).toEqual([{ id: 1 }]);
        expect(res.total).toBe(1);
    });

    it('list sem filtros envia só page/limit', async () => {
        await dealershipsService.list();
        expect(mockGet).toHaveBeenCalledWith('/dealerships', {
            params: { page: 1, limit: 200 },
        });
    });

    it('getById → GET /dealerships/{id}', async () => {
        await dealershipsService.getById(7);
        expect(mockGet).toHaveBeenCalledWith('/dealerships/7');
    });

    it('deactivate → DELETE /dealerships/{id}', async () => {
        await dealershipsService.deactivate(7);
        expect(mockDelete).toHaveBeenCalledWith('/dealerships/7');
    });

    it('activate → PATCH /dealerships/{id} { is_active: true }', async () => {
        await dealershipsService.activate(7);
        expect(mockPatch).toHaveBeenCalledWith('/dealerships/7', { is_active: true });
    });
});
