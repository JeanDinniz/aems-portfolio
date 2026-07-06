import { notificationsService } from '@/services/api/notifications.service';

/**
 * NOT-01 — notificationsService (camada de dados).
 * Verifica paths/params/body de cada método e o formato de retorno.
 * O apiClient é mockado (named export `{ apiClient }`).
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/services/api/client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        post: (...args: unknown[]) => mockPost(...args),
        patch: (...args: unknown[]) => mockPatch(...args),
    },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ data: { items: [], pagination: { total: 0, page: 1, limit: 20 } } });
    mockPost.mockResolvedValue({ data: {} });
    mockPatch.mockResolvedValue({ data: {} });
});

describe('notificationsService.list', () => {
    it('faz GET /notifications com page/limit padrão (1/20)', async () => {
        await notificationsService.list();
        expect(mockGet).toHaveBeenCalledWith('/notifications', { params: { page: 1, limit: 20 } });
    });

    it('repassa page/limit informados', async () => {
        await notificationsService.list(3, 50);
        expect(mockGet).toHaveBeenCalledWith('/notifications', { params: { page: 3, limit: 50 } });
    });

    it('retorna { items, pagination } da resposta', async () => {
        mockGet.mockResolvedValueOnce({
            data: { items: [{ id: 1 }], pagination: { total: 1, page: 1, limit: 20 } },
        });
        const res = await notificationsService.list();
        expect(res.items).toHaveLength(1);
        expect(res.pagination.total).toBe(1);
    });
});

describe('notificationsService.getUnreadCount', () => {
    it('faz GET /notifications/unread-count e extrai count', async () => {
        mockGet.mockResolvedValueOnce({ data: { count: 7 } });
        const count = await notificationsService.getUnreadCount();
        expect(mockGet).toHaveBeenCalledWith('/notifications/unread-count');
        expect(count).toBe(7);
    });
});

describe('notificationsService.markAsRead', () => {
    it('faz PATCH /notifications/{id}/read', async () => {
        await notificationsService.markAsRead(42);
        expect(mockPatch).toHaveBeenCalledWith('/notifications/42/read');
    });
});

describe('notificationsService.markAllAsRead', () => {
    it('faz POST /notifications/mark-all-read', async () => {
        mockPost.mockResolvedValueOnce({ data: { updated: 3, message: 'ok' } });
        const res = await notificationsService.markAllAsRead();
        expect(mockPost).toHaveBeenCalledWith('/notifications/mark-all-read');
        expect(res).toEqual({ updated: 3, message: 'ok' });
    });
});
