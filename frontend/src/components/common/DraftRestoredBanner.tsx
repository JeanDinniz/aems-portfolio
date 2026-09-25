/**
 * Aviso de "Rascunho recuperado" exibido no topo de um formulário quando um
 * rascunho local (localStorage) foi restaurado. Ver `useFormDraft`.
 *
 * `role="status"` (aria-live polite implícito) para que leitores de tela
 * anunciem a recuperação. O botão "Descartar" chama `onDiscard`, que deve
 * limpar o rascunho e devolver o form ao estado base/vazio.
 */
interface DraftRestoredBannerProps {
    /** Descarta o rascunho e limpa o formulário. */
    onDiscard: () => void;
}

export function DraftRestoredBanner({ onDiscard }: DraftRestoredBannerProps) {
    return (
        <div
            role="status"
            className="flex items-center justify-between rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
            <span>Rascunho recuperado</span>
            <button
                type="button"
                onClick={onDiscard}
                className="font-semibold underline hover:no-underline"
            >
                Descartar
            </button>
        </div>
    );
}
