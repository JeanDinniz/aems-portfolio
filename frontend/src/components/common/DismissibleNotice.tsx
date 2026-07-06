import { useState, type ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface DismissibleNoticeProps {
    /** Chave única no localStorage; uma vez dispensado, não reaparece neste navegador. */
    storageKey: string;
    title: string;
    children: ReactNode;
    className?: string;
}

/**
 * Banner de aviso dispensável que não reaparece após fechado (lembrado via localStorage).
 * Útil para notas de atualização exibidas em formulários.
 */
export function DismissibleNotice({ storageKey, title, children, className }: DismissibleNoticeProps) {
    const [visible, setVisible] = useState(() => {
        try {
            return localStorage.getItem(storageKey) !== 'dismissed';
        } catch {
            return true;
        }
    });

    if (!visible) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(storageKey, 'dismissed');
        } catch {
            /* localStorage indisponível (modo privado, etc.) — apenas oculta nesta sessão */
        }
        setVisible(false);
    };

    return (
        <div
            className={`flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 ${className ?? ''}`}
        >
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{title}</p>
                <div className="text-xs text-amber-800 dark:text-amber-200 mt-1">{children}</div>
            </div>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Fechar aviso"
                className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 shrink-0"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
