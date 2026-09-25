/**
 * Paleta centralizada de cores para todos os gráficos do dashboard.
 * Importar daqui evita hardcode espalhado em RevenueTrendChart,
 * DepartmentDonut, StoreRankingCard, ServicesTopCard, etc.
 */

export const CHART_COLORS = {
  /** Cor brand amarelo AEMS — barras de receita por loja */
  brand: '#F5A800',
  /** Azul — Película / serviços */
  blue: '#3b82f6',
  /** Verde — Estética / indicadores positivos */
  green: '#10b981',
  /** Índigo/roxo — PPF / pel. segurança */
  indigo: '#6366f1',
  /** Violeta */
  violet: '#8b5cf6',
  /** Âmbar — Funilaria / atenção */
  amber: '#f59e0b',
  /** Vermelho — Oficina / alertas */
  red: '#ef4444',
  /** Roxo claro — indigo suave */
  indigoLight: '#818cf8',
  /** Teal — fallback */
  teal: '#14b8a6',
  /** Laranja */
  orange: '#f97316',
  /** Rosa */
  pink: '#ec4899',
  /** Lima */
  lime: '#84cc16',
  /** Cinza neutro — estados inativos/finalizados (ex.: fatia "Finalizadas" de donuts) */
  neutral: '#9ca3af',
} as const;

/** Mapa de cores por departamento (reutilizado no DepartmentDonut e DashboardPage) */
export const DEPT_COLORS: Record<string, string> = {
  film: CHART_COLORS.blue,
  security_film: CHART_COLORS.indigoLight,
  ppf: CHART_COLORS.indigo,
  bodywork: CHART_COLORS.amber,
  vn: CHART_COLORS.green,
  vu: CHART_COLORS.violet,
  workshop: CHART_COLORS.red,
};

export const DEPT_FALLBACK_COLORS = [
  CHART_COLORS.teal,
  CHART_COLORS.orange,
  CHART_COLORS.pink,
  CHART_COLORS.lime,
];
