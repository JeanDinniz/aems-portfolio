import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { InventoryRollsScreen } from '@/screens/inventory/InventoryRollsScreen';
import { RollDetailScreen } from '@/screens/inventory/RollDetailScreen';
import { CreateRollScreen } from '@/screens/inventory/CreateRollScreen';
import { FilmTypesScreen } from '@/screens/inventory/FilmTypesScreen';
import { FilmTypeServicesScreen } from '@/screens/inventory/FilmTypeServicesScreen';
import { TransferRollScreen } from '@/screens/inventory/TransferRollScreen';
import { EditRollScreen } from '@/screens/inventory/EditRollScreen';
import { CriticalRollsScreen } from '@/screens/inventory/CriticalRollsScreen';
import { ForecastScreen } from '@/screens/inventory/ForecastScreen';
import { WithdrawalsScreen } from '@/screens/inventory/WithdrawalsScreen';

import type { InventoryStackParamList } from './types';

const Stack = createNativeStackNavigator<InventoryStackParamList>();

/**
 * Stack do módulo Estoque (dentro da aba Estoque).
 *
 * `headerShown: false` — cada tela desenha o próprio header preto.
 *
 * INV-04 (CreateRoll), INV-06 (FilmTypes + FilmTypeServices) já implementados.
 * Ações de bobina (transferir/esgotar/restaurar/excluir — INV-05) ficam no
 * RollDetail via sheet/Alert, sem rota dedicada.
 */
export function InventoryStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="InventoryRolls" component={InventoryRollsScreen} />
            <Stack.Screen name="RollDetail" component={RollDetailScreen} />
            <Stack.Screen name="CreateRoll" component={CreateRollScreen} />
            <Stack.Screen name="FilmTypes" component={FilmTypesScreen} />
            <Stack.Screen name="FilmTypeServices" component={FilmTypeServicesScreen} />
            <Stack.Screen name="TransferRoll" component={TransferRollScreen} />
            <Stack.Screen name="EditRoll" component={EditRollScreen} />
            <Stack.Screen name="CriticalRolls" component={CriticalRollsScreen} />
            <Stack.Screen name="Forecast" component={ForecastScreen} />
            <Stack.Screen name="Withdrawals" component={WithdrawalsScreen} />
        </Stack.Navigator>
    );
}
