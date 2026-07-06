import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'nativewind';

import { useSettingsStore } from '@/stores/settings.store';
import { themeColors, type ColorScheme } from './tokens';

/**
 * ThemeProvider (DS-01 + HARD-04).
 *
 * Honra a preferência persistida em `settings.store` (`themePreference`):
 * - `'system'` → NativeWind volta a seguir o esquema do SO;
 * - `'light'`/`'dark'` → força o esquema manualmente.
 *
 * A aplicação acontece num `useEffect` que reage a `themePreference`. Como o
 * persist do settings.store reidrata de forma assíncrona (AsyncStorage) e emite
 * um update ao terminar, o efeito roda de novo assim que a preferência
 * persistida chega — deixando o app no tema salvo já na primeira sessão. O
 * `colorScheme` resolvido pelo NativeWind continua sendo a fonte de verdade para
 * `scheme`/`isDark`/`colors` (props nativas).
 */
interface ThemeContextValue {
  /** 'light' | 'dark' — esquema efetivo em uso. */
  scheme: ColorScheme;
  isDark: boolean;
  /** Cores resolvidas para props nativas (não-className). */
  colors: ReturnType<typeof themeColors>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme, setColorScheme } = useColorScheme();
  const themePreference = useSettingsStore((s) => s.themePreference);

  // Aplica a preferência ao NativeWind. NativeWind aceita 'system' | 'light' |
  // 'dark'; com 'system' volta a seguir o SO. Roda de novo quando o persist
  // reidrata e emite o valor salvo.
  useEffect(() => {
    setColorScheme(themePreference);
  }, [themePreference, setColorScheme]);

  const scheme: ColorScheme = colorScheme === 'dark' ? 'dark' : 'light';

  const value = useMemo<ThemeContextValue>(
    () => ({ scheme, isDark: scheme === 'dark', colors: themeColors(scheme) }),
    [scheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Acesso ao tema atual (esquema + cores resolvidas para props nativas). */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme deve ser usado dentro de <ThemeProvider>.');
  }
  return ctx;
}
