import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme';
import { useCanView } from '@/hooks/useMyPermissions';
import { useUnreadCount } from '@/hooks/useNotifications';
import { HomeScreen } from '@/screens/HomeScreen';
import { MoreScreen } from '@/screens/MoreScreen';
import { ServiceOrdersStack } from './ServiceOrdersStack';
import { SchedulingStack } from './SchedulingStack';
import { InventoryStack } from './InventoryStack';

import type { AppTabsParamList } from './types';

const Tab = createBottomTabNavigator<AppTabsParamList>();

const ACTIVE = '#F5B800';

/** Ícone por aba (outline inativa / filled ativa via foco). */
const TAB_ICON: Record<keyof AppTabsParamList, keyof typeof Ionicons.glyphMap> = {
    Inicio: 'home',
    ServiceOrders: 'clipboard',
    Scheduling: 'calendar',
    Inventory: 'cube',
    More: 'menu',
};

/**
 * Barra inferior híbrida (doc 03 §1). Abas condicionais por permissão:
 * - Início e Mais: sempre visíveis.
 * - O.S., Agendamentos, Estoque: só com `can_view` do respectivo submódulo
 *   (Owner vê todas — `useCanView` já trata).
 *
 * As telas desenham o próprio header preto; o navigator usa `headerShown: false`.
 */
export function AppTabs() {
    const { isDark, colors } = useTheme();
    const canViewOS = useCanView('service_orders');
    const canViewScheduling = useCanView('scheduling');
    const canViewInventory = useCanView('inventory');
    const { data: unreadCount = 0 } = useUnreadCount();
    const moreBadge = unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined;

    return (
        <Tab.Navigator
            screenOptions={({ route }) => ({
                headerShown: false,
                tabBarActiveTintColor: ACTIVE,
                tabBarInactiveTintColor: colors.textMuted,
                tabBarStyle: {
                    backgroundColor: colors.surface,
                    borderTopColor: isDark ? '#222222' : '#F0F2F5',
                },
                tabBarLabelStyle: { fontSize: 11 },
                tabBarIcon: ({ color, size, focused }) => {
                    const base = TAB_ICON[route.name];
                    const name = (focused ? base : `${base}-outline`) as keyof typeof Ionicons.glyphMap;
                    return <Ionicons name={name} size={size} color={color} />;
                },
            })}
        >
            <Tab.Screen name="Inicio" component={HomeScreen} options={{ tabBarLabel: 'Início' }} />
            {canViewOS ? (
                <Tab.Screen
                    name="ServiceOrders"
                    component={ServiceOrdersStack}
                    options={{ tabBarLabel: 'O.S.' }}
                />
            ) : null}
            {canViewScheduling ? (
                <Tab.Screen
                    name="Scheduling"
                    component={SchedulingStack}
                    options={{ tabBarLabel: 'Agendamentos' }}
                />
            ) : null}
            {canViewInventory ? (
                <Tab.Screen
                    name="Inventory"
                    component={InventoryStack}
                    options={{ tabBarLabel: 'Estoque' }}
                />
            ) : null}
            <Tab.Screen
                name="More"
                component={MoreScreen}
                options={{ tabBarLabel: 'Mais', tabBarBadge: moreBadge }}
            />
        </Tab.Navigator>
    );
}
