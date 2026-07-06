import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SchedulingListScreen } from '@/screens/scheduling/SchedulingListScreen';
import { AppointmentDetailScreen } from '@/screens/scheduling/AppointmentDetailScreen';
import { CreateAppointmentScreen } from '@/screens/scheduling/CreateAppointmentScreen';
import { EditAppointmentScreen } from '@/screens/scheduling/EditAppointmentScreen';
import { GenerateOSScreen } from '@/screens/scheduling/GenerateOSScreen';

import type { SchedulingStackParamList } from './types';

const Stack = createNativeStackNavigator<SchedulingStackParamList>();

/**
 * Stack do módulo Agendamentos (dentro da aba Agendamentos).
 *
 * `headerShown: false` — cada tela desenha o próprio header preto (cabeçalho da
 * lista / ScreenHeader) fiel ao padrão das O.S.
 *
 * CreateAppointment/EditAppointment/GenerateOS usam as telas reais
 * (AGD-03/04/05). Não restam stubs "Em breve" no fluxo de agendamento.
 */
export function SchedulingStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="SchedulingList" component={SchedulingListScreen} />
            <Stack.Screen name="AppointmentDetail" component={AppointmentDetailScreen} />
            <Stack.Screen name="CreateAppointment" component={CreateAppointmentScreen} />
            <Stack.Screen name="EditAppointment" component={EditAppointmentScreen} />
            <Stack.Screen name="GenerateOS" component={GenerateOSScreen} />
        </Stack.Navigator>
    );
}
