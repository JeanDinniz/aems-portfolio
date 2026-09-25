/**
 * Helpers de data sem dependência externa (date-fns/dayjs não instalados).
 * Tudo em pt-BR. Aceitam ISO string, Date ou null/undefined.
 */

const MONTHS_FULL = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
];

const WEEKDAYS_FULL = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
];

function toDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    // Data pura "YYYY-MM-DD" (ex.: delivery_date): parse LOCAL. `new Date('2026-08-04')`
    // é interpretado como meia-noite UTC e, em fusos negativos (UTC-3), volta um dia ao
    // formatar com getDate() local — mostrava 03/08 para uma entrega em 04/08.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
        const [, y, m, d] = dateOnly;
        return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

/** "18/06/2026" — vazio ('—') se inválido. */
export function formatDateBR(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "18/06/2026 14:32" — vazio ('—') se inválido. */
export function formatDateTimeBR(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return `${formatDateBR(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "14:32" — vazio ('—') se inválido. */
export function formatTimeBR(value: string | Date | null | undefined): string {
    const d = toDate(value);
    if (!d) return '—';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * "14:32" a partir de um horário do backend no formato `HH:MM` ou `HH:MM:SS`
 * (campo `time` serializado pelo FastAPI vem com segundos). Não usa `Date` para
 * evitar a armadilha de montar um ISO inválido (`...T14:30:00:00`). '—' se vazio.
 */
export function formatClock(value: string | null | undefined): string {
    if (!value) return '—';
    const m = /^(\d{1,2}):(\d{2})/.exec(value);
    if (!m) return '—';
    return `${pad2(Number(m[1]))}:${m[2]}`;
}

/** "quinta-feira, 18 de junho" (sem ano) — usada na saudação da Home. */
export function formatWeekdayLong(value?: string | Date | null): string {
    const d = toDate(value) ?? new Date();
    return `${WEEKDAYS_FULL[d.getDay()]}, ${d.getDate()} de ${MONTHS_FULL[d.getMonth()]}`;
}

/**
 * Tempo relativo curto em pt-BR a partir de um instante (ISO completo com
 * data+hora). Ex.: "agora", "há 5 min", "há 2 h", "há 3 d". Acima de 7 dias
 * cai para a data absoluta (DD/MM/AAAA). '—' se inválido.
 *
 * `now` é injetável para testes determinísticos.
 */
export function formatRelativeTime(
    value: string | Date | null | undefined,
    now: Date = new Date()
): string {
    const d = toDate(value);
    if (!d) return '—';
    const diffMs = now.getTime() - d.getTime();
    // Futuro (clock skew) ou < 1 min → "agora".
    if (diffMs < 60_000) return 'agora';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days <= 7) return `há ${days} d`;
    return formatDateBR(d);
}

/** Saudação dependente da hora local. */
export function greetingForHour(date: Date = new Date()): string {
    const h = date.getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
}

/**
 * "AAAA-MM-DD" no fuso LOCAL do dispositivo (não UTC). Use isto para inputs de
 * data e params de export — `new Date().toISOString().slice(0,10)` volta a data
 * de ONTEM no fim do dia em UTC-3 (bug histórico do projeto).
 */
export function ymdLocal(d: Date = new Date()): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * `{ date_from, date_to }` do MÊS VIGENTE (1º ao último dia) em AAAA-MM-DD, fuso
 * local. Espelha `getCurrentMonthRange` do web — usado no Resumo por Loja do
 * Agendamento para dar números do mês (não de todo o histórico).
 */
export function getCurrentMonthRange(base: Date = new Date()): {
    date_from: string;
    date_to: string;
} {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { date_from: ymdLocal(first), date_to: ymdLocal(last) };
}
