import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormDraft } from './useFormDraft';
import { loadDraft, saveDraft } from '@/lib/draftStorage';

interface Draft {
    n: number;
}

const KEY = 'aems-draft:test';

describe('useFormDraft', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('autosalva (debounced) o valor quando shouldPersist aprova', () => {
        const { rerender } = renderHook(
            (props: { value: Draft }) =>
                useFormDraft<Draft>({
                    key: KEY,
                    enabled: true,
                    value: props.value,
                    onRestore: () => {},
                    shouldPersist: () => true,
                }),
            { initialProps: { value: { n: 1 } } }
        );
        act(() => rerender({ value: { n: 2 } }));
        expect(loadDraft<Draft>(KEY)).toBeNull(); // ainda no debounce
        act(() => vi.advanceTimersByTime(400));
        expect(loadDraft<Draft>(KEY)).toEqual({ n: 2 });
    });

    it('discard() cancela o autosave pendente — sem ressurreição', () => {
        const { result, rerender } = renderHook(
            (props: { value: Draft }) =>
                useFormDraft<Draft>({
                    key: KEY,
                    enabled: true,
                    value: props.value,
                    onRestore: () => {},
                    shouldPersist: () => true,
                }),
            { initialProps: { value: { n: 1 } } }
        );
        // Agenda um save (mudança de valor) e descarta ANTES do debounce disparar.
        act(() => rerender({ value: { n: 9 } }));
        act(() => result.current.discard());
        act(() => vi.advanceTimersByTime(400));
        expect(loadDraft<Draft>(KEY)).toBeNull(); // não regravou o rascunho descartado
    });

    it('shouldPersist=false bloqueia a gravação da base', () => {
        const { rerender } = renderHook(
            (props: { value: Draft }) =>
                useFormDraft<Draft>({
                    key: KEY,
                    enabled: true,
                    value: props.value,
                    onRestore: () => {},
                    shouldPersist: () => false,
                }),
            { initialProps: { value: { n: 1 } } }
        );
        act(() => rerender({ value: { n: 2 } }));
        act(() => vi.advanceTimersByTime(400));
        expect(loadDraft<Draft>(KEY)).toBeNull();
    });

    it('onRestore que retorna false não marca restored e ignora o rascunho', () => {
        saveDraft<Draft>(KEY, { n: 42 });
        const onRestore = vi.fn(() => false);
        const { result } = renderHook(() =>
            useFormDraft<Draft>({
                key: KEY,
                enabled: true,
                value: { n: 0 },
                onRestore,
                shouldPersist: () => false,
            })
        );
        expect(onRestore).toHaveBeenCalledWith({ n: 42 });
        expect(result.current.restored).toBe(false);
    });

    it('sem shouldPersist, grava sempre (comportamento padrão)', () => {
        const { rerender } = renderHook(
            (props: { value: Draft }) =>
                useFormDraft<Draft>({
                    key: KEY,
                    enabled: true,
                    value: props.value,
                    onRestore: () => {},
                }),
            { initialProps: { value: { n: 1 } } }
        );
        act(() => rerender({ value: { n: 7 } }));
        act(() => vi.advanceTimersByTime(400));
        expect(loadDraft<Draft>(KEY)).toEqual({ n: 7 });
    });

    it('onRestore compatível marca restored=true e aplica o rascunho', () => {
        saveDraft<Draft>(KEY, { n: 42 });
        const applied: number[] = [];
        const { result } = renderHook(() =>
            useFormDraft<Draft>({
                key: KEY,
                enabled: true,
                value: { n: 0 },
                onRestore: (d) => {
                    applied.push(d.n);
                },
            })
        );
        expect(applied).toEqual([42]);
        expect(result.current.restored).toBe(true);
    });

    it('após discard, uma nova edição volta a gravar (autosave segue armado)', () => {
        const { result, rerender } = renderHook(
            (props: { value: Draft }) =>
                useFormDraft<Draft>({
                    key: KEY,
                    enabled: true,
                    value: props.value,
                    onRestore: () => {},
                    shouldPersist: () => true,
                }),
            { initialProps: { value: { n: 1 } } }
        );
        act(() => result.current.discard());
        act(() => rerender({ value: { n: 3 } }));
        act(() => vi.advanceTimersByTime(400));
        expect(loadDraft<Draft>(KEY)).toEqual({ n: 3 });
    });

    it('não autosalva enquanto enabled=false', () => {
        const { rerender } = renderHook(
            (props: { enabled: boolean; value: Draft }) =>
                useFormDraft<Draft>({
                    key: KEY,
                    enabled: props.enabled,
                    value: props.value,
                    onRestore: () => {},
                    shouldPersist: () => true,
                }),
            { initialProps: { enabled: false, value: { n: 1 } } }
        );
        act(() => rerender({ enabled: false, value: { n: 5 } }));
        act(() => vi.advanceTimersByTime(400));
        expect(loadDraft<Draft>(KEY)).toBeNull();
    });
});
