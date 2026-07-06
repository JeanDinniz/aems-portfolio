/**
 * Adaptado para React Native (Bloco B).
 *
 * No web (frontend/src/constants/departments.ts) cada entrada era uma string de
 * classes Tailwind (ex.: 'bg-purple-100 text-purple-700 border-purple-300 dark:...').
 * No RN não há classes utilitárias aplicáveis a tokens dinâmicos via runtime, então
 * convertemos cada entrada para um objeto `{ bg, fg, border }` com hex (tema claro).
 * Os hex correspondem às cores padrão do Tailwind. Tema escuro será tratado em DS-01.
 */

export interface DepartmentColor {
    bg: string;
    fg: string;
    border: string;
}

export const DEPARTMENT_COLORS: Record<string, DepartmentColor> = {
    film: { bg: '#F3E8FF', fg: '#7E22CE', border: '#D8B4FE' }, // purple
    security_film: { bg: '#E0E7FF', fg: '#4338CA', border: '#A5B4FC' }, // indigo
    ppf: { bg: '#DBEAFE', fg: '#1D4ED8', border: '#93C5FD' }, // blue
    vn: { bg: '#DCFCE7', fg: '#15803D', border: '#86EFAC' }, // green
    vd: { bg: '#CCFBF1', fg: '#0F766E', border: '#5EEAD4' }, // teal
    vu: { bg: '#FEF9C3', fg: '#A16207', border: '#FDE047' }, // yellow
    bodywork: { bg: '#FFEDD5', fg: '#C2410C', border: '#FDBA74' }, // orange
    workshop: { bg: '#F4F4F5', fg: '#3F3F46', border: '#D4D4D8' }, // zinc
};

export const CATEGORY_COLORS: Record<string, DepartmentColor> = {
    insulfilm: { bg: '#F3E8FF', fg: '#7E22CE', border: '#D8B4FE' }, // purple
    ppf: { bg: '#DBEAFE', fg: '#1D4ED8', border: '#93C5FD' }, // blue
    pelicula_seguranca: { bg: '#E0E7FF', fg: '#4338CA', border: '#A5B4FC' }, // indigo
    estetica: { bg: '#FFEDD5', fg: '#C2410C', border: '#FDBA74' }, // orange
};

export const DEPARTMENT_FALLBACK_COLOR: DepartmentColor = {
    bg: '#F4F4F5',
    fg: '#3F3F46',
    border: '#D4D4D8',
}; // zinc

export const CATEGORY_FALLBACK_COLOR: DepartmentColor = {
    bg: '#FEF3C7',
    fg: '#B45309',
    border: '#FDE68A',
}; // amber
