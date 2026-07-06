/**
 * Constantes de Estoque (INV-02/03) — adaptadas do web
 * `frontend/src/pages/inventory/InventoryPage.tsx` (COLOR_CONFIG).
 *
 * A cor (`FilmRoll.color`) é calculada pelo BACKEND — o app NÃO recalcula. Aqui
 * só mapeamos cada cor para rótulo + tokens hex (faixa/ponto/badge) usados no
 * RollCard e no detalhe. Hex equivalentes às cores Tailwind do web:
 *  - blue   → Em estoque (azul)
 *  - green  → Em uso (verde, acima do limiar)
 *  - yellow → Alerta (amarelo, abaixo do limiar amarelo)
 *  - red    → Esgotada (vermelho)
 */

import type { FilmRollColor, FilmRollStatus, FilmDepartment } from '@/services/api/inventory.service';

export interface RollColorConfig {
    /** Rótulo do badge de status (espelha COLOR_CONFIG.badge do web). */
    label: string;
    /** Cor sólida da faixa lateral / barra de metragem / ponto. */
    solid: string;
    /** Fundo suave do badge (tema claro). */
    badgeBg: string;
    /** Cor do texto do badge (tema claro). */
    badgeFg: string;
    /** Trilho de fundo da barra de metragem. */
    track: string;
}

/**
 * cor → { label, tokens }. Rótulos fiéis ao web:
 * blue="Em Estoque" · green="Em Uso" · yellow="Alerta" · red="Esgotado".
 */
export const ROLL_COLOR_CONFIG: Record<FilmRollColor, RollColorConfig> = {
    blue: {
        label: 'Em Estoque',
        solid: '#3B82F6', // blue-500
        badgeBg: '#DBEAFE', // blue-100
        badgeFg: '#1D4ED8', // blue-700
        track: '#E5EDFB',
    },
    green: {
        label: 'Em Uso',
        solid: '#22C55E', // green-500
        badgeBg: '#DCFCE7', // green-100
        badgeFg: '#15803D', // green-700
        track: '#E3F6E9',
    },
    yellow: {
        label: 'Alerta',
        solid: '#FACC15', // yellow-400
        badgeBg: '#FEF9C3', // yellow-100
        badgeFg: '#A16207', // yellow-700
        track: '#FBF4D0',
    },
    red: {
        label: 'Esgotado',
        solid: '#EF4444', // red-500
        badgeBg: '#FEE2E2', // red-100
        badgeFg: '#B91C1C', // red-700
        track: '#FBE3E3',
    },
};

/** Rótulos pt-BR dos departamentos de película (filtro de bobinas). */
export const FILM_DEPARTMENT_OPTIONS: { value: FilmDepartment; label: string }[] = [
    { value: 'film', label: 'Película' },
    { value: 'security_film', label: 'Película de Segurança' },
    { value: 'ppf', label: 'PPF' },
];

/** Rótulos pt-BR dos status de bobina (filtro de bobinas). */
export const FILM_ROLL_STATUS_OPTIONS: { value: FilmRollStatus; label: string }[] = [
    { value: 'em_estoque', label: 'Em estoque' },
    { value: 'em_uso', label: 'Em uso' },
    { value: 'esgotada', label: 'Esgotada' },
];

export const FILM_DEPARTMENT_LABELS: Record<FilmDepartment, string> = {
    film: 'Película',
    security_film: 'Película de Segurança',
    ppf: 'PPF',
};

export const FILM_ROLL_STATUS_LABELS: Record<FilmRollStatus, string> = {
    em_estoque: 'Em estoque',
    em_uso: 'Em uso',
    esgotada: 'Esgotada',
};
