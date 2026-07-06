import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from '@/stores/auth.store';
import { SplashScreen } from '@/screens/SplashScreen';
import { ChangePasswordScreen } from '@/screens/auth/ChangePasswordScreen';

import { AuthStack } from './AuthStack';
import { AppStack } from './AppStack';
import type { AppStackParamList } from './types';

const GateStack = createNativeStackNavigator<AppStackParamList>();

/**
 * Gate bloqueante de troca de senha (1º acesso). Monta APENAS a tela de troca,
 * impedindo navegar para o app até `must_change_password` zerar.
 */
function ChangePasswordGate() {
    return (
        <GateStack.Navigator screenOptions={{ headerShown: false }}>
            <GateStack.Screen name="ChangePassword" component={ChangePasswordScreen} />
        </GateStack.Navigator>
    );
}

/**
 * Navegador raiz reativo ao auth store (AUTH-03):
 *  - `isLoading` → Splash (durante reidratação/bootstrap)
 *  - deslogado → AuthStack
 *  - logado + `must_change_password` → gate bloqueante
 *  - logado → AppStack
 */
export function RootNavigator() {
    const isLoading = useAuthStore((s) => s.isLoading);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const mustChangePassword = useAuthStore((s) => !!s.user?.must_change_password);

    if (isLoading) return <SplashScreen />;
    if (!isAuthenticated) return <AuthStack />;
    if (mustChangePassword) return <ChangePasswordGate />;
    return <AppStack />;
}
