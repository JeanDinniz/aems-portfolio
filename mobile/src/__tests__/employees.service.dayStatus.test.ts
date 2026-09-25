import { employeesService } from '@/services/api/employees.service';

/**
 * Faltas do Dia — métodos estendidos de employeesService: dayStatus,
 * createMovement, deleteMovement, returnFromAbsence. Valida URL/params/body de
 * cada chamada. O apiClient é mockado (named export `{ apiClient }`).
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        post: (...args: unknown[]) => mockPost(...args),
        delete: (...args: unknown[]) => mockDelete(...args),
    },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: {} });
    mockPost.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: undefined });
});

describe('employeesService.dayStatus', () => {
    it('faz GET /employees/day-status com store_id e date', async () => {
        const payload = { items: [], present: 0, faults: 0, vacations: 0, absences: 0 };
        mockGet.mockResolvedValueOnce({ data: payload });

        const res = await employeesService.dayStatus(3, '2026-07-20');

        expect(mockGet).toHaveBeenCalledWith('/employees/day-status', {
            params: { store_id: 3, date: '2026-07-20' },
        });
        expect(res).toEqual(payload);
    });
});

describe('employeesService.createMovement', () => {
    it('faz POST /employees/{id}/movements com o payload (falta + anexo)', async () => {
        const created = { id: 99, type: 'fault' };
        mockPost.mockResolvedValueOnce({ data: created });

        const payload = {
            type: 'fault' as const,
            movement_date: '2026-07-20',
            movement_data: { fault_type: 'atestado', date: '2026-07-20', days_count: 1 },
            notes: 'atestado entregue',
            attachment_url: 'https://srv/atestado.jpg',
        };
        const res = await employeesService.createMovement(7, payload);

        expect(mockPost).toHaveBeenCalledWith('/employees/7/movements', payload);
        expect(res).toEqual(created);
    });
});

describe('employeesService.deleteMovement', () => {
    it('faz DELETE /employees/{id}/movements/{movementId}', async () => {
        await employeesService.deleteMovement(7, 55);
        expect(mockDelete).toHaveBeenCalledWith('/employees/7/movements/55');
    });
});

describe('employeesService.returnFromAbsence', () => {
    it('faz POST /employees/{id}/return-from-absence', async () => {
        await employeesService.returnFromAbsence(7);
        expect(mockPost).toHaveBeenCalledWith('/employees/7/return-from-absence');
    });
});
