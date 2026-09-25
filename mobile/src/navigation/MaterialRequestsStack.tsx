import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
    MaterialRequestsListScreen,
    CreateMaterialRequestScreen,
    EditMaterialRequestScreen,
    type MaterialRequestsStackParamList,
} from '@/screens/material-requests';

const Stack = createNativeStackNavigator<MaterialRequestsStackParamList>();

/**
 * Stack do módulo "Pedidos de Material" (rota web /pedidos), acessível pelo menu
 * Mais → Pedidos de Material. `headerShown: false` — cada tela desenha o próprio
 * header preto.
 */
export function MaterialRequestsStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="MaterialRequestsList" component={MaterialRequestsListScreen} />
            <Stack.Screen name="CreateMaterialRequest" component={CreateMaterialRequestScreen} />
            <Stack.Screen name="EditMaterialRequest" component={EditMaterialRequestScreen} />
        </Stack.Navigator>
    );
}
