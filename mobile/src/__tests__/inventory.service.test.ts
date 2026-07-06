import { AxiosError } from 'axios';

import {
    inventoryService,
    CriticalRollsError,
    isCriticalRollsError,
} from '@/services/api/inventory.service';

/**
 * INV-01 — inventoryService (camada de dados de Estoque).
 * Testa construção de URL/params/body de cada método e, em destaque, o fluxo de
 * `createRoll` com 409 + header `X-Has-Critical-Rolls` (→ CriticalRollsError).
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

/** Constrói um AxiosError com status + headers (para o fluxo 409). */
function axiosError(status: number, headers: Record<string, string> = {}): AxiosError {
    const err = new Error('request failed') as AxiosError;
    // marca como AxiosError para qualquer checagem futura
    (err as unknown as { isAxiosError: boolean }).isAxiosError = true;
    err.response = {
        status,
        data: { detail: 'erro' },
        statusText: '',
        headers,
        config: {} as never,
    } as never;
    return err;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: { items: [], pagination: { total: 0 } } });
    mockPost.mockResolvedValue({ data: { id: 1 } });
    mockPatch.mockResolvedValue({ data: { id: 1 } });
    mockDelete.mockResolvedValue({ data: {} });
});

describe('inventoryService.createRoll', () => {
    const payload = {
        store_id: 1,
        film_type_id: 2,
        total_meters: 30,
        receipt_date: '2026-06-21',
    };

    it('envia ?force=false por padrão e retorna a bobina', async () => {
        mockPost.mockResolvedValueOnce({ data: { id: 9, store_id: 1 } });
        const roll = await inventoryService.createRoll(payload);
        expect(mockPost).toHaveBeenCalledWith('/inventory/rolls', payload, {
            params: { force: false },
        });
        expect(roll).toEqual({ id: 9, store_id: 1 });
    });

    it('envia ?force=true quando force=true', async () => {
        await inventoryService.createRoll(payload, true);
        expect(mockPost).toHaveBeenCalledWith('/inventory/rolls', payload, {
            params: { force: true },
        });
    });

    it('409 + X-Has-Critical-Rolls → lança CriticalRollsError (force=false)', async () => {
        mockPost.mockRejectedValueOnce(
            axiosError(409, { 'x-has-critical-rolls': 'true' })
        );
        await expect(inventoryService.createRoll(payload)).rejects.toBeInstanceOf(
            CriticalRollsError
        );
        try {
            await inventoryService.createRoll(payload);
        } catch (err) {
            expect(isCriticalRollsError(err)).toBe(true);
            expect((err as CriticalRollsError).hasCriticalRolls).toBe(true);
            expect((err as CriticalRollsError).status).toBe(409);
        }
    });

    it('com force=true, um 409 NÃO vira CriticalRollsError (propaga o erro original)', async () => {
        const original = axiosError(409, { 'x-has-critical-rolls': 'true' });
        mockPost.mockRejectedValueOnce(original);
        await expect(inventoryService.createRoll(payload, true)).rejects.toBe(original);
    });

    it('outros erros (ex.: 500) propagam inalterados', async () => {
        const original = axiosError(500);
        mockPost.mockRejectedValueOnce(original);
        await expect(inventoryService.createRoll(payload)).rejects.toBe(original);
    });
});

describe('inventoryService — ações de bobina', () => {
    it('transferRoll manda target_store_id no body', async () => {
        await inventoryService.transferRoll(5, 8);
        expect(mockPost).toHaveBeenCalledWith('/inventory/rolls/5/transfer', {
            target_store_id: 8,
        });
    });

    it('exhaustRoll faz PATCH /exhaust', async () => {
        await inventoryService.exhaustRoll(5);
        expect(mockPatch).toHaveBeenCalledWith('/inventory/rolls/5/exhaust');
    });

    it('restoreRoll faz PATCH /restore', async () => {
        await inventoryService.restoreRoll(5);
        expect(mockPatch).toHaveBeenCalledWith('/inventory/rolls/5/restore');
    });

    it('deleteRoll faz DELETE /inventory/rolls/{id}', async () => {
        await inventoryService.deleteRoll(5);
        expect(mockDelete).toHaveBeenCalledWith('/inventory/rolls/5');
    });

    it('listRollConsumptions faz GET /consumptions e retorna o array', async () => {
        mockGet.mockResolvedValueOnce({ data: [{ id: 1, meters_consumed: 3 }] });
        const res = await inventoryService.listRollConsumptions(5);
        expect(mockGet).toHaveBeenCalledWith('/inventory/rolls/5/consumptions');
        expect(res).toHaveLength(1);
    });

    it('getRoll deriva o detalhe de listRolls filtrando por id', async () => {
        mockGet.mockResolvedValueOnce({
            data: { items: [{ id: 1 }, { id: 7 }], pagination: { total: 2 } },
        });
        const roll = await inventoryService.getRoll(7);
        expect(mockGet).toHaveBeenCalledWith('/inventory/rolls', expect.anything());
        expect(roll).toEqual({ id: 7 });
    });
});

describe('inventoryService — tipos de película', () => {
    it('createFilmType faz POST /film-types com o payload', async () => {
        const p = {
            name: 'X',
            department: 'film' as const,
            yellow_threshold_meters: 10,
            red_threshold_meters: 5,
        };
        await inventoryService.createFilmType(p);
        expect(mockPost).toHaveBeenCalledWith('/film-types', p);
    });

    it('updateFilmType faz PATCH /film-types/{id} com payload parcial', async () => {
        await inventoryService.updateFilmType(3, { name: 'Y' });
        expect(mockPatch).toHaveBeenCalledWith('/film-types/3', { name: 'Y' });
    });

    it('deleteFilmType faz DELETE /film-types/{id}', async () => {
        await inventoryService.deleteFilmType(3);
        expect(mockDelete).toHaveBeenCalledWith('/film-types/3');
    });

    it('addServiceToFilmType faz POST /film-types/{id}/services', async () => {
        await inventoryService.addServiceToFilmType(3, { service_id: 9, meters_consumed: 2 });
        expect(mockPost).toHaveBeenCalledWith('/film-types/3/services', {
            service_id: 9,
            meters_consumed: 2,
        });
    });

    it('removeServiceFromFilmType faz DELETE /film-types/{id}/services/{serviceId}', async () => {
        await inventoryService.removeServiceFromFilmType(3, 9);
        expect(mockDelete).toHaveBeenCalledWith('/film-types/3/services/9');
    });
});
