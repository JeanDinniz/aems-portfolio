// env mockado com um IP de LAN para validar a reescrita de host local.
jest.mock('@/lib/env', () => ({
    env: { API_URL: 'http://192.168.1.7:8000/api/v1', WS_URL: 'ws://192.168.1.7:8000', ENV: 'development' },
}));

import { resolveMediaUrl } from '@/lib/resolveMediaUrl';

describe('resolveMediaUrl', () => {
    it('reescreve localhost:8000 (filesystem) para o host da API', () => {
        expect(resolveMediaUrl('http://localhost:8000/uploads/photos/a.jpg')).toBe(
            'http://192.168.1.7:8000/uploads/photos/a.jpg'
        );
    });

    it('reescreve 127.0.0.1:9000 (MinIO) preservando a porta', () => {
        expect(resolveMediaUrl('http://127.0.0.1:9000/aems-files/a.jpg')).toBe(
            'http://192.168.1.7:9000/aems-files/a.jpg'
        );
    });

    it('prefixa URL relativa com a origem da API', () => {
        expect(resolveMediaUrl('/uploads/x.jpg')).toBe('http://192.168.1.7:8000/uploads/x.jpg');
    });

    it('mantém host real (produção/CDN) intacto', () => {
        expect(resolveMediaUrl('https://aems.example.com/uploads/x.jpg')).toBe(
            'https://aems.example.com/uploads/x.jpg'
        );
    });

    it('trata vazio/null', () => {
        expect(resolveMediaUrl(undefined)).toBe('');
        expect(resolveMediaUrl(null)).toBe('');
        expect(resolveMediaUrl('')).toBe('');
    });
});
