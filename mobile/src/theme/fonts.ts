import { useFonts } from 'expo-font';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';

/**
 * Carrega as fontes da marca (DS-01).
 *
 * - DM Sans (corpo/UI): Regular / Medium / SemiBold / Bold.
 * - Barlow (display/títulos): SemiBold / Bold.
 *
 * Os nomes das famílias (chaves) batem com os configurados em
 * `tailwind.config.js` (`fontFamily.sans`, `font-display`, etc.).
 */
export function useAppFonts(): boolean {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Barlow_600SemiBold,
    Barlow_700Bold,
  });
  return fontsLoaded;
}
