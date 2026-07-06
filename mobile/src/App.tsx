import '../global.css';

import { useEffect } from 'react';
import { Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/lib/queryClient';
import { RootNavigator } from '@/navigation/RootNavigator';
import { linking } from '@/navigation/linking';
import { navigationRef } from '@/navigation/navigationRef';
import { SplashScreen } from '@/screens/SplashScreen';
import { useAuthStore } from '@/stores/auth.store';
import { setSessionEndedHandler } from '@/services/api/client';
import { ThemeProvider } from '@/theme';
import { useAppFonts } from '@/theme/fonts';
import { ToastProvider } from '@/components/ui';
import { BiometricGate } from '@/components/BiometricGate';
import { WebSocketProvider } from '@/providers/WebSocketProvider';
import { PushProvider } from '@/providers/PushProvider';
import { initSentry, wrapApp } from '@/lib/sentry';

// Crash reporting (HARD-02): inicializa o mais cedo possível, antes do render.
// Sem SENTRY_DSN é um no-op total — o app roda idêntico a hoje. Ver lib/sentry.
initSentry();

function App() {
  // DS-01: carrega DM Sans + Barlow. A SplashScreen permanece até as fontes
  // estarem prontas (combinado com o bootstrap de auth abaixo).
  const fontsLoaded = useAppFonts();

  // Bootstrap de sessão (AUTH-03): reidrata o persist e restaura tokens do
  // SecureStore validando expiração, antes de liberar a navegação.
  useEffect(() => {
    let active = true;
    (async () => {
      await useAuthStore.persist.rehydrate();
      if (active) await useAuthStore.getState().bootstrapAuth();
    })();

    // Alerta de "sessão encerrada em outro aparelho" disparado pelo apiClient.
    setSessionEndedHandler((reason) =>
      Alert.alert(
        'Sessão encerrada',
        reason || 'Sua sessão foi encerrada (login em outro aparelho).'
      )
    );

    return () => {
      active = false;
      setSessionEndedHandler(null);
    };
  }, []);

  if (!fontsLoaded) {
    return <SplashScreen />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <WebSocketProvider>
              <PushProvider>
                <BottomSheetModalProvider>
                  <ToastProvider>
                    <NavigationContainer
                      ref={navigationRef}
                      linking={linking}
                      fallback={<SplashScreen />}
                    >
                      <StatusBar style="light" />
                      <BiometricGate>
                        <RootNavigator />
                      </BiometricGate>
                    </NavigationContainer>
                  </ToastProvider>
                </BottomSheetModalProvider>
              </PushProvider>
            </WebSocketProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Envolve com o error boundary do Sentry QUANDO há DSN; sem DSN devolve o App
// intacto (sem branch no call site). Ver lib/sentry.
export default wrapApp(App);
