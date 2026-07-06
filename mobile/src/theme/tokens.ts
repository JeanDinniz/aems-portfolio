/**
 * Tokens de design AEMS Mobile (DS-01).
 *
 * Espelham os valores de `tailwind.config.js` (e dos `globals.css` do web) para
 * uso em props nativas que NÃO aceitam classes NativeWind: `color` de
 * `ActivityIndicator`, `placeholderTextColor`, `tintColor`, sombras, etc.
 *
 * Regra de ouro: para estilo de layout/cor use classes NativeWind (`className`).
 * Estes tokens são apenas para os pontos onde só existe a API de prop nativa.
 */

/** Marca — constante nos dois temas. */
export const brand = {
  DEFAULT: '#F5B800',
  hover: '#FFB800',
  black: '#1A1A1A',
} as const;

/** Neutros (tema claro) — iguais ao tailwind.config. */
export const neutral = {
  50: '#F8F9FB',
  100: '#F0F2F5',
  150: '#E4E7EC',
  200: '#D0D5DD',
  300: '#98A2B3',
  400: '#667085',
  500: '#475467',
  600: '#344054',
  700: '#1D2939',
  800: '#141B2D',
  900: '#0C111D',
  950: '#080B14',
} as const;

/** Semânticas (claro / escuro). */
export const semantic = {
  success: { light: '#12B76A', dark: '#34D399' },
  warning: { light: '#F79009', dark: '#FBBF24' },
  error: { light: '#F04438', dark: '#F87171' },
  info: { light: '#2E90FA', dark: '#60A5FA' },
  purple: { light: '#7A5AF8', dark: '#A48AFB' },
} as const;

/** Superfícies do tema escuro (06_DESIGN_SYSTEM §2.2). */
export const dark = {
  bg: '#111111',
  surface: '#1A1A1A',
  elevated: '#222222',
  input: '#0D0D0D',
  border: '#2A2A2A',
  borderSoft: '#1E1E1E',
  borderStrong: '#333333',
  text: '#FFFFFF',
  textMuted: '#999999',
  textSubtle: '#555555',
} as const;

export type ColorScheme = 'light' | 'dark';

/**
 * Resolve cores comuns por esquema, para props nativas.
 * Ex.: `themeColors('dark').inputBorder`.
 */
export function themeColors(scheme: ColorScheme) {
  const isDark = scheme === 'dark';
  return {
    brand: brand.DEFAULT,
    background: isDark ? dark.bg : neutral[50],
    surface: isDark ? dark.surface : '#FFFFFF',
    text: isDark ? dark.text : neutral[900],
    textMuted: isDark ? dark.textMuted : neutral[400],
    placeholder: isDark ? dark.textSubtle : neutral[300],
    inputBorder: isDark ? dark.borderStrong : neutral[200],
    inputBg: isDark ? dark.input : '#FFFFFF',
    success: isDark ? semantic.success.dark : semantic.success.light,
    warning: isDark ? semantic.warning.dark : semantic.warning.light,
    error: isDark ? semantic.error.dark : semantic.error.light,
    info: isDark ? semantic.info.dark : semantic.info.light,
  } as const;
}

export const tokens = { brand, neutral, semantic, dark, themeColors } as const;
