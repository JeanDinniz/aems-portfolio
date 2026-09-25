import { describe, it, expect } from 'vitest';
import { buildPhotoCaption } from '../photoCaption';

describe('buildPhotoCaption', () => {
    it('junta placa e Nº da OS', () => {
        expect(buildPhotoCaption('ABC1D23', '8891')).toBe('ABC1D23 · OS 8891');
    });

    it('aceita chassi do vidro no lugar da placa', () => {
        expect(buildPhotoCaption('9BWZZZ12', '8891')).toBe('9BWZZZ12 · OS 8891');
    });

    it('omite a OS quando não informada', () => {
        expect(buildPhotoCaption('ABC1D23', null)).toBe('ABC1D23');
        expect(buildPhotoCaption('ABC1D23', '   ')).toBe('ABC1D23');
    });

    it('omite a placa quando não informada', () => {
        expect(buildPhotoCaption(undefined, '8891')).toBe('OS 8891');
    });

    it('retorna vazio sem placa e sem OS', () => {
        expect(buildPhotoCaption(null, undefined)).toBe('');
    });

    it('remove espaços em volta dos valores', () => {
        expect(buildPhotoCaption('  ABC1D23 ', ' 8891 ')).toBe('ABC1D23 · OS 8891');
    });
});
