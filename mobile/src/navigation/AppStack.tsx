import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ProfileScreen } from '@/screens/ProfileScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { ChangePasswordScreen } from '@/screens/auth/ChangePasswordScreen';
import { PhotoViewerScreen } from '@/screens/PhotoViewerScreen';
import { ConferenceScreen } from '@/screens/service-orders/ConferenceScreen';
import { FechamentoScreen } from '@/screens/service-orders/FechamentoScreen';
import { NotificationsScreen } from '@/screens/notifications/NotificationsScreen';
import { DashboardScreen } from '@/screens/dashboard/DashboardScreen';

import { AppTabs } from './AppTabs';
import { AdminStack } from './AdminStack';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

/**
 * Stack do usuário logado. Hospeda o AppTabs (barra inferior híbrida) + telas e
 * modais globais (Profile, ChangePassword, PhotoViewer).
 *
 * `Tabs` desenha os próprios headers (headerShown:false). `Profile` e
 * `ChangePassword` também trazem header próprio. `PhotoViewer` é um modal de
 * tela cheia sem header.
 */
export function AppStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Tabs" component={AppTabs} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
            <Stack.Screen name="Conference" component={ConferenceScreen} />
            <Stack.Screen name="Fechamento" component={FechamentoScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="Admin" component={AdminStack} />
            <Stack.Screen
                name="PhotoViewer"
                component={PhotoViewerScreen}
                options={{ presentation: 'fullScreenModal', animation: 'fade' }}
            />
        </Stack.Navigator>
    );
}
