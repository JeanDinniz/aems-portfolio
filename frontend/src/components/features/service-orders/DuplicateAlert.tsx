import { AlertTriangle } from 'lucide-react';
import type { DuplicateCheckResult } from '@/services/api/service-orders.service';

interface DuplicateAlertProps {
    result?: DuplicateCheckResult | null;
}

/** Formata YYYY-MM-DD → DD/MM/YYYY. Devolve a string original se não combinar. */
function formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return value;
    return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Banner de aviso de possível duplicidade (não bloqueante).
 * Renderiza null quando não há matches.
 */
export function DuplicateAlert({ result }: DuplicateAlertProps) {
    if (
        !result ||
        (result.service_orders.length === 0 && result.appointments.length === 0)
    ) {
        return null;
    }

    return (
        <div
            role="alert"
            className="flex gap-2.5 rounded-lg border-2 border-red-500 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:border-red-600 dark:text-red-200"
        >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0">
                <p className="font-semibold leading-snug">Possível duplicidade</p>
                <p className="mt-0.5 text-xs opacity-90">
                    Este veículo já possui lançamento(s) nesta data/departamento:
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs">
                    {result.service_orders.map((os) => (
                        <li key={`os-${os.id}`} className="flex items-start gap-1">
                            <span className="mt-px opacity-60">•</span>
                            <span>
                                <span className="font-medium">
                                    O.S. {os.order_number ?? `#${os.id}`}
                                </span>
                                {os.matched_services.length > 0 && (
                                    <> &mdash; {os.matched_services.join(', ')}</>
                                )}{' '}
                                já lançada em{' '}
                                <span className="font-medium">{formatDate(os.service_date)}</span>
                            </span>
                        </li>
                    ))}
                    {result.appointments.map((appt) => (
                        <li key={`appt-${appt.id}`} className="flex items-start gap-1">
                            <span className="mt-px opacity-60">•</span>
                            <span>
                                <span className="font-medium">Agendamento #{appt.id}</span>
                                {appt.matched_services.length > 0 && (
                                    <> &mdash; {appt.matched_services.join(', ')}</>
                                )}{' '}
                                já agendado para{' '}
                                <span className="font-medium">{formatDate(appt.delivery_date)}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
