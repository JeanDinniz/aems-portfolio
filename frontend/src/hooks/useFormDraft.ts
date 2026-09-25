/**
 * Restauração + autosave debounced + descarte de RASCUNHO de formulário.
 *
 * Espelha a mecânica do rascunho de O.S. do mobile (autosave no `watch()`,
 * guard antes de restaurar, `discard()` explícito) usando localStorage no
 * lugar do AsyncStorage. Ver `mobile/src/screens/service-orders/
 * CreateServiceOrderScreen.tsx` (autosave ~l.628-643) e
 * `frontend/src/lib/draftStorage.ts`.
 *
 * Uso típico:
 * ```ts
 * const { discard, restored } = useFormDraft({
 *     key: 'aems-draft:quick-create-os',
 *     enabled: open,
 *     value: draftValue, // snapshot serializável do form (sem mídia)
 *     onRestore: (draft) => reset({ ...getValues(), ...draft }),
 * });
 * ```
 *
 * Formulário com 1 rascunho por "tipo" (ex.: novo vs. edição de um registro
 * específico) valida a compatibilidade dentro de `onRestore` e retorna
 * `false` para ignorar um rascunho de outro contexto:
 * ```ts
 * onRestore: (draft) => {
 *     if (draft.appointmentId !== appointment?.id) return false;
 *     reset(draft.form);
 *     return true;
 * },
 * ```
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { loadDraft, saveDraft, clearDraft } from '@/lib/draftStorage';

const AUTOSAVE_DEBOUNCE_MS = 400;

export interface UseFormDraftOptions<T> {
    /** Chave namespaced (`aems-draft:<form>`) onde o rascunho é persistido. */
    key: string;
    /** Liga a restauração/autosave — normalmente `open` do modal/painel. */
    enabled: boolean;
    /** Snapshot serializável atual do formulário (nunca inclua mídia). */
    value: T;
    /**
     * Aplica o rascunho carregado — chamado UMA vez ao abrir, se existir.
     * Formulários com mais de um "contexto" possível (ex.: criar vs. editar
     * um registro específico) devem checar a compatibilidade do rascunho
     * antes de aplicá-lo e retornar `false` quando NÃO for compatível — nesse
     * caso o rascunho é ignorado e `restored` permanece `false`. Retornar
     * `true`/`undefined` (ou não retornar nada) sinaliza restauração aplicada.
     */
    onRestore: (draft: T) => void | boolean;
    /**
     * Portão do autosave: só grava quando retorna `true`. Sem ele, o form
     * gravaria um rascunho "base" já na abertura (os efeitos de open mutam
     * campos DEPOIS de armar o autosave) e o banner "Rascunho recuperado"
     * reapareceria num form intocado. Passe o "sujo" do formulário — ex.:
     * `formState.isDirty` do react-hook-form, que é `false` após abrir/`reset`
     * e só vira `true` com edição real do usuário (vale para criar e editar).
     * Ausente ⇒ persiste sempre (compatível com estado não-RHF que só muda por
     * ação do usuário, como os maps do step finalize). Espelha o `hasContent`
     * do rascunho do mobile.
     */
    shouldPersist?: (value: T) => boolean;
}

export interface UseFormDraftResult {
    /**
     * Apaga o rascunho persistido e cancela o autosave pendente. O guard
     * `restoredRef` segue armado (o autosave volta a gravar quando o usuário
     * editar de novo) — o portão `shouldPersist` é que evita regravar a base.
     */
    discard: () => void;
    /** `true` quando um rascunho foi restaurado nesta abertura. */
    restored: boolean;
}

export function useFormDraft<T>({
    key,
    enabled,
    value,
    onRestore,
    shouldPersist,
}: UseFormDraftOptions<T>): UseFormDraftResult {
    const [restored, setRestored] = useState(false);
    const restoredRef = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onRestoreRef = useRef(onRestore);
    onRestoreRef.current = onRestore;
    const shouldPersistRef = useRef(shouldPersist);
    shouldPersistRef.current = shouldPersist;

    // Restaura ao abrir; reseta o guard ao fechar (para re-restaurar na próxima abertura).
    useEffect(() => {
        if (!enabled) {
            restoredRef.current = false;
            setRestored(false);
            return;
        }
        const draft = loadDraft<T>(key);
        if (draft !== null) {
            const applied = onRestoreRef.current(draft);
            if (applied !== false) setRestored(true);
        }
        restoredRef.current = true;
    }, [key, enabled]);

    // Autosave debounced — só grava depois que a restauração já aconteceu (guard
    // `restoredRef`, para não sobrescrever com os defaults) E quando `shouldPersist`
    // aprova (para não gravar a base intocada da abertura).
    useEffect(() => {
        if (!enabled || !restoredRef.current) return;
        const gate = shouldPersistRef.current;
        if (gate && !gate(value)) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveDraft(key, value);
        }, AUTOSAVE_DEBOUNCE_MS);
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const discard = useCallback(() => {
        // Cancela qualquer autosave pendente — senão um timer agendado logo antes
        // do discard (ex.: usuário edita e clica "Salvar" em < debounce) dispararia
        // depois e RESSUSCITARIA o rascunho de um registro já concluído.
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        clearDraft(key);
        setRestored(false);
        // NÃO zera `restoredRef`: o autosave segue armado nesta sessão aberta, para
        // que edições posteriores (banner "Descartar" e recomeçar; "Salvar e Próxima")
        // gerem um novo rascunho. Quem impede regravar a base após um `reset` é o
        // portão `shouldPersist` (isDirty volta a `false` no reset). Ao fechar
        // (enabled→false), o efeito de restauração zera o guard de todo modo.
    }, [key]);

    return { discard, restored };
}
