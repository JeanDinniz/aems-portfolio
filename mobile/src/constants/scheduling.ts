import type { AppointmentDisplayStatus } from '@/types/scheduling.types';
import { DEPARTMENT_COLORS } from '@/constants/departments';

/**
 * Adaptado para React Native (Bloco B).
 *
 * Diferenças em relação ao web:
 * - `APPOINTMENT_STATUS_CONFIG` no web tinha props que eram classes Tailwind
 *   (`borderColor: 'border-l-red-500'`, `bgDot: 'bg-red-500'`,
 *   `bgCard: 'bg-red-50 dark:...'`). Aqui convertemos tudo para hex (tema claro)
 *   com o shape `{ label, color, border, dot, cardBg }`.
 * - O reexport de DEPARTMENT_COLORS (agora objetos {bg,fg,border}) é mantido.
 * - STATUS_PRIORITY, DEPARTMENT_LABELS, FILM_TONALITY_OPTIONS, getTonalityOptions
 *   permanecem 1:1.
 */

export { DEPARTMENT_COLORS as DEPARTMENT_BADGE_COLORS };

export const APPOINTMENT_STATUS_CONFIG: Record<
    AppointmentDisplayStatus,
    {
        label: string;
        color: string; // cor principal do status
        border: string; // borda lateral do card
        dot: string; // indicador (bolinha)
        cardBg: string; // fundo do card (tema claro)
    }
> = {
    atrasado: { label: 'Atrasado', color: '#EF4444', border: '#EF4444', dot: '#EF4444', cardBg: '#FEF2F2' },
    atencao: { label: 'Atenção', color: '#F59E0B', border: '#F59E0B', dot: '#F59E0B', cardBg: '#FFFBEB' },
    agendado: { label: 'Agendado', color: '#3B82F6', border: '#3B82F6', dot: '#3B82F6', cardBg: '#EFF6FF' },
    em_execucao: { label: 'Em execução', color: '#22C55E', border: '#22C55E', dot: '#22C55E', cardBg: '#F0FDF4' },
    finalizado: { label: 'Finalizado', color: '#A855F7', border: '#A855F7', dot: '#A855F7', cardBg: '#FAF5FF' },
    cancelado: { label: 'Cancelado', color: '#9CA3AF', border: '#9CA3AF', dot: '#9CA3AF', cardBg: '#F3F4F6' },
};

export const DEPARTMENT_LABELS: Record<string, string> = {
    film: 'Película',
    security_film: 'Película de Segurança',
    ppf: 'PPF',
    bodywork: 'Funilaria',
    vn: 'VN',
    vd: 'VD',
    vu: 'VU',
    workshop: 'Oficina',
};

export const STATUS_PRIORITY: Record<AppointmentDisplayStatus, number> = {
    atrasado: 0,
    atencao: 1,
    agendado: 2,
    em_execucao: 3,
    finalizado: 4,
    cancelado: 5,
};

export const FILM_TONALITY_OPTIONS = [
    { value: 'G05', label: 'G05' },
    { value: 'G20', label: 'G20' },
    { value: 'G35', label: 'G35' },
    { value: 'G50', label: 'G50' },
    { value: 'G75', label: 'G75' },
    { value: 'Incolor', label: 'Incolor' },
];

// Serviços de Película Transparente: apenas G75 e Incolor são válidos
export const TRANSPARENT_FILM_CODES = ['WB'];
export const TRANSPARENT_FILM_TONALITIES = ['G75', 'Incolor'];

export function getTonalityOptions(serviceCode: string | null | undefined) {
    if (serviceCode && TRANSPARENT_FILM_CODES.some((c) => serviceCode.startsWith(c))) {
        return FILM_TONALITY_OPTIONS.filter((opt) => TRANSPARENT_FILM_TONALITIES.includes(opt.value));
    }
    return FILM_TONALITY_OPTIONS;
}

/**
 * A7 — Opções de tonalidade dirigidas pelo tipo de película.
 *
 * Espelha o `getTonalityOptions({ serviceCode, department, availableTonalities })`
 * do web. Prioridade:
 *  1) `availableTonalities` (configuradas no FilmType via `available_tonalities`)
 *     — GOVERNA: filtra `FILM_TONALITY_OPTIONS` pelas tonalidades configuradas
 *     (mantém a ordem canônica). Tonalidades fora da lista base são acrescentadas
 *     ao final, preservando o que o backend retornar.
 *  2) Fallback (tipo ausente/sem tonalidades): cai no `getTonalityOptions(serviceCode)`
 *     atual (restrição WB → G75/Incolor) e, fora de `security_film`, remove
 *     "Incolor" (paridade com o web).
 *
 * O `getTonalityOptions(serviceCode)` legado é preservado para os usos que ainda
 * dependem só do código do serviço.
 */
export function getTonalityOptionsForFilmType(opts?: {
    serviceCode?: string | null;
    department?: string | null;
    availableTonalities?: string[] | null;
}) {
    const { serviceCode, department, availableTonalities } = opts ?? {};

    // 1) Configurável por tipo de película (governa).
    if (availableTonalities && availableTonalities.length > 0) {
        const known = FILM_TONALITY_OPTIONS.filter((opt) =>
            availableTonalities.includes(opt.value)
        );
        const knownValues = new Set(known.map((opt) => opt.value));
        const extras = availableTonalities
            .filter((t) => !knownValues.has(t))
            .map((t) => ({ value: t, label: t }));
        return [...known, ...extras];
    }

    // 2) Fallback por serviço/departamento.
    let options = getTonalityOptions(serviceCode);
    if (department !== 'security_film') {
        options = options.filter((opt) => opt.value !== 'Incolor');
    }
    return options;
}
