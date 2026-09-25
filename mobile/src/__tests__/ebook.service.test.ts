import { ebookService } from '@/services/api/ebook.service';

/**
 * E-book — ebookService (camada de dados). Testa a construção de
 * URL/params/body de cada método exposto no mobile (leitura + certificados,
 * SEM o CRUD admin de conteúdo).
 *
 * O apiClient é mockado (named export `{ apiClient }`); capturamos os args.
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
    mockGet.mockResolvedValue({ data: { items: [], pagination: { total: 0 } } });
    mockPost.mockResolvedValue({ data: { id: 1 } });
    mockDelete.mockResolvedValue({ data: {} });
});

describe('ebookService.list', () => {
    it('faz GET /ebook com os params e retorna items+pagination', async () => {
        mockGet.mockResolvedValueOnce({
            data: {
                items: [{ id: 1, title: 'Vitrificação' }],
                pagination: { total: 1 },
            },
        });
        const res = await ebookService.list({ limit: 200, is_active: true });
        expect(mockGet).toHaveBeenCalledWith('/ebook', {
            params: { limit: 200, is_active: true },
        });
        expect(res.items).toHaveLength(1);
        expect(res.pagination.total).toBe(1);
    });

    it('sem argumentos passa params=undefined', async () => {
        await ebookService.list();
        expect(mockGet).toHaveBeenCalledWith('/ebook', { params: undefined });
    });
});

describe('ebookService.getById', () => {
    it('faz GET /ebook/{id} e retorna o verbete', async () => {
        mockGet.mockResolvedValueOnce({ data: { id: 7, title: 'Insulfilm' } });
        const res = await ebookService.getById(7);
        expect(mockGet).toHaveBeenCalledWith('/ebook/7');
        expect(res).toEqual({ id: 7, title: 'Insulfilm' });
    });
});

describe('ebookService.listCertificates', () => {
    it('faz GET /ebook/certificates com os params', async () => {
        mockGet.mockResolvedValueOnce({
            data: { items: [{ id: 3 }], pagination: { total: 1 } },
        });
        const res = await ebookService.listCertificates({ page: 1, limit: 50 });
        expect(mockGet).toHaveBeenCalledWith('/ebook/certificates', {
            params: { page: 1, limit: 50 },
        });
        expect(res.items).toHaveLength(1);
    });
});

describe('ebookService.createCertificate', () => {
    it('faz POST /ebook/certificates com o payload', async () => {
        mockPost.mockResolvedValueOnce({ data: { id: 9, plate: 'ABC1D23' } });
        const payload = {
            brand_code: 'toyota',
            brand_name: 'Toyota',
            store_id: 2,
            plate: 'ABC1D23',
            customer_name: 'Fulano',
            invoice_number: 'NF-1',
            chassi: '9BW...',
        };
        const res = await ebookService.createCertificate(payload);
        expect(mockPost).toHaveBeenCalledWith('/ebook/certificates', payload);
        expect(res).toEqual({ id: 9, plate: 'ABC1D23' });
    });
});

describe('ebookService.deleteCertificate', () => {
    it('faz DELETE /ebook/certificates/{id} e resolve undefined', async () => {
        const res = await ebookService.deleteCertificate(5);
        expect(mockDelete).toHaveBeenCalledWith('/ebook/certificates/5');
        expect(res).toBeUndefined();
    });
});
