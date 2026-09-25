import { timeClockService } from '@/services/api/time-clock.service';

/**
 * Ponto Eletrônico — timeClockService (camada de dados).
 *
 * Testa a construção de URL/body de `punch`/`me` e o formato de retorno. O
 * apiClient é mockado (named export `{ apiClient }`).
 */
const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        post: (...args: unknown[]) => mockPost(...args),
    },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: {} });
    mockPost.mockResolvedValue({ data: {} });
});

describe('timeClockService.punch', () => {
    it('faz POST /time-clock/punch com o payload e devolve o registro', async () => {
        const created = {
            id: 10,
            type: 'in',
            recorded_at: '2026-07-13T08:00:00',
            photo_url: 'https://srv/selfie.jpg',
            distance_m: 5,
            is_within_radius: true,
        };
        mockPost.mockResolvedValueOnce({ data: created });

        const payload = {
            type: 'in' as const,
            photo_url: 'https://srv/selfie.jpg',
            latitude: -23.5,
            longitude: -46.6,
            accuracy_m: 12,
        };
        const result = await timeClockService.punch(payload);

        expect(mockPost).toHaveBeenCalledWith('/time-clock/punch', payload);
        expect(result).toEqual(created);
    });

    it('propaga o erro do apiClient (409/422) sem tratar', async () => {
        const err = Object.assign(new Error('conflict'), {
            isAxiosError: true,
            response: { status: 409, data: { detail: 'A primeira batida do dia deve ser entrada.' } },
        });
        mockPost.mockRejectedValueOnce(err);

        await expect(
            timeClockService.punch({
                type: 'out',
                photo_url: 'x',
                latitude: 0,
                longitude: 0,
            })
        ).rejects.toBe(err);
    });
});

describe('timeClockService.me', () => {
    it('faz GET /time-clock/me e devolve o payload (com face_enrolled)', async () => {
        const me = {
            employee_id: 3,
            employee_name: 'João',
            store_name: 'Loja Centro',
            work_start_time: '08:00:00',
            work_end_time: '18:00:00',
            last_type: 'in',
            face_enrolled: true,
            today: [],
            recent: [],
        };
        mockGet.mockResolvedValueOnce({ data: me });

        const result = await timeClockService.me();

        expect(mockGet).toHaveBeenCalledWith('/time-clock/me');
        expect(result).toEqual(me);
        expect(result.face_enrolled).toBe(true);
    });

    it('assume face_enrolled=false quando o backend não envia (defensivo)', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                employee_id: 3,
                employee_name: 'João',
                store_name: 'Loja Centro',
                work_start_time: null,
                work_end_time: null,
                last_type: null,
                today: [],
                recent: [],
            },
        });
        const result = await timeClockService.me();
        expect(result.face_enrolled).toBe(false);
    });

    it('devolve employee_id null quando sem vínculo', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                employee_id: null,
                employee_name: null,
                store_name: null,
                work_start_time: null,
                work_end_time: null,
                last_type: null,
                today: [],
                recent: [],
            },
        });
        const result = await timeClockService.me();
        expect(result.employee_id).toBeNull();
    });

    it('faz POST /time-clock/enroll-face com o embedding + consent', async () => {
        const created = { enrolled: true, enrolled_at: '2026-07-28T10:00:00', dimension: 512 };
        mockPost.mockResolvedValueOnce({ data: created });

        const payload = { embedding: [0.1, 0.2, 0.3], consent: true };
        const result = await timeClockService.enrollFace(payload);

        expect(mockPost).toHaveBeenCalledWith('/time-clock/enroll-face', payload);
        expect(result).toEqual(created);
    });
});

describe('timeClockService.list (Espelho de Ponto)', () => {
    it('faz GET /time-clock com os params de filtro/paginação', async () => {
        const page = {
            items: [],
            pagination: {
                page: 1,
                limit: 20,
                total: 0,
                total_pages: 0,
                has_next: false,
                has_prev: false,
            },
        };
        mockGet.mockResolvedValueOnce({ data: page });

        const params = { store_id: 3, date: '2026-07-20', page: 1, limit: 20 };
        const result = await timeClockService.list(params);

        expect(mockGet).toHaveBeenCalledWith('/time-clock', { params });
        expect(result).toEqual(page);
    });

    it('omite store_id/date quando não informados', async () => {
        await timeClockService.list({ page: 2, limit: 20 });
        expect(mockGet).toHaveBeenCalledWith('/time-clock', {
            params: { page: 2, limit: 20 },
        });
    });
});

describe('timeClockService.myMirror (Meu Espelho — autoatendimento)', () => {
    it('faz GET /time-clock/me/mirror com o período e devolve os itens', async () => {
        const resp = {
            period: '24h',
            employee_id: 3,
            employee_name: 'João',
            store_name: 'Loja Centro',
            start: '2026-08-04T08:00:00-03:00',
            end: '2026-08-05T08:00:00-03:00',
            items: [
                {
                    id: 1,
                    type: 'in',
                    recorded_at: '2026-08-05T08:00:00',
                    photo_url: null,
                    distance_m: null,
                    is_within_radius: true,
                    source: 'admin_adjustment',
                    adjustment_reason: 'esqueceu de bater',
                },
            ],
        };
        mockGet.mockResolvedValueOnce({ data: resp });

        const result = await timeClockService.myMirror('24h');

        expect(mockGet).toHaveBeenCalledWith('/time-clock/me/mirror', {
            params: { period: '24h' },
        });
        expect(result).toEqual(resp);
    });

    it('aceita o período "month"', async () => {
        await timeClockService.myMirror('month');
        expect(mockGet).toHaveBeenCalledWith('/time-clock/me/mirror', {
            params: { period: 'month' },
        });
    });
});
