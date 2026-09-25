import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadDraft, saveDraft, clearDraft } from '@/lib/draftStorage';

interface SampleDraft {
    plate: string;
    department?: string;
}

const KEY = 'aems-draft:test';

describe('draftStorage', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('loadDraft retorna null quando não há rascunho salvo', () => {
        expect(loadDraft<SampleDraft>(KEY)).toBeNull();
    });

    it('saveDraft grava e loadDraft recupera o mesmo objeto', () => {
        const draft: SampleDraft = { plate: 'ABC1234', department: 'film' };
        saveDraft(KEY, draft);
        expect(loadDraft<SampleDraft>(KEY)).toEqual(draft);
    });

    it('clearDraft apaga o rascunho salvo', () => {
        saveDraft(KEY, { plate: 'ABC1234' });
        clearDraft(KEY);
        expect(loadDraft<SampleDraft>(KEY)).toBeNull();
    });

    it('loadDraft retorna null quando o JSON salvo está corrompido', () => {
        localStorage.setItem(KEY, '{not-valid-json');
        expect(loadDraft<SampleDraft>(KEY)).toBeNull();
    });

    it('saveDraft não lança quando localStorage.setItem lança (modo privado/quota)', () => {
        const spy = vi
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });
        expect(() => saveDraft(KEY, { plate: 'ABC1234' })).not.toThrow();
        spy.mockRestore();
    });

    it('loadDraft não lança quando localStorage.getItem lança', () => {
        const spy = vi
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('SecurityError');
            });
        expect(() => loadDraft<SampleDraft>(KEY)).not.toThrow();
        expect(loadDraft<SampleDraft>(KEY)).toBeNull();
        spy.mockRestore();
    });

    it('clearDraft não lança quando localStorage.removeItem lança', () => {
        const spy = vi
            .spyOn(Storage.prototype, 'removeItem')
            .mockImplementation(() => {
                throw new Error('SecurityError');
            });
        expect(() => clearDraft(KEY)).not.toThrow();
        spy.mockRestore();
    });
});
