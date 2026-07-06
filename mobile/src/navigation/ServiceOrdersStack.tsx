import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ServiceOrdersListScreen } from '@/screens/service-orders/ServiceOrdersListScreen';
import { ServiceOrderDetailScreen } from '@/screens/service-orders/ServiceOrderDetailScreen';
import { CreateServiceOrderScreen } from '@/screens/service-orders/CreateServiceOrderScreen';
import { EditServiceOrderScreen } from '@/screens/service-orders/EditServiceOrderScreen';
import { FinalizeOSScreen } from '@/screens/service-orders/FinalizeOSScreen';

import type { ServiceOrdersStackParamList } from './types';

const Stack = createNativeStackNavigator<ServiceOrdersStackParamList>();

/**
 * Stack do módulo Ordens de Serviço (dentro da aba O.S.).
 *
 * `headerShown: false` — cada tela desenha o próprio header preto (ScreenHeader /
 * cabeçalho da lista) fiel ao Figma.
 */
export function ServiceOrdersStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ServiceOrdersList" component={ServiceOrdersListScreen} />
            <Stack.Screen name="ServiceOrderDetail" component={ServiceOrderDetailScreen} />
            <Stack.Screen name="CreateServiceOrder" component={CreateServiceOrderScreen} />
            <Stack.Screen name="EditServiceOrder" component={EditServiceOrderScreen} />
            <Stack.Screen name="FinalizeOS" component={FinalizeOSScreen} />
        </Stack.Navigator>
    );
}
