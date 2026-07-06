import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AdminHubScreen } from '@/screens/admin/AdminHubScreen';
import { UsersAdminScreen } from '@/screens/admin/UsersAdminScreen';
import { UserDetailScreen } from '@/screens/admin/UserDetailScreen';
import { EmployeesAdminScreen } from '@/screens/admin/EmployeesAdminScreen';
import { EmployeeDetailScreen } from '@/screens/admin/EmployeeDetailScreen';
import { ConsultantsAdminScreen } from '@/screens/admin/ConsultantsAdminScreen';
import { StoresAdminScreen } from '@/screens/admin/StoresAdminScreen';
import { AccessProfilesAdminScreen } from '@/screens/admin/AccessProfilesAdminScreen';
import { AccessProfileDetailScreen } from '@/screens/admin/AccessProfileDetailScreen';
import { BrandsAdminScreen } from '@/screens/admin/BrandsAdminScreen';
import { VehicleModelsAdminScreen } from '@/screens/admin/VehicleModelsAdminScreen';
import { ServicesAdminScreen } from '@/screens/admin/ServicesAdminScreen';
import { SuppliersAdminScreen } from '@/screens/admin/SuppliersAdminScreen';
import { DealershipsAdminScreen } from '@/screens/admin/DealershipsAdminScreen';

import type { AdminStackParamList } from './types';

const Stack = createNativeStackNavigator<AdminStackParamList>();

/**
 * Stack do módulo Administração (acessível pelo menu Mais → Administração).
 *
 * `headerShown: false` — cada tela desenha o próprio header preto.
 *
 * Fatia 5a: Hub + Users/User, Employees/Employee, Consultants, Stores,
 * AccessProfiles/AccessProfile. A Fatia 5b acrescenta os catálogos: Brands,
 * VehicleModels, Services, Suppliers e Dealerships.
 */
export function AdminStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="AdminHub" component={AdminHubScreen} />
            <Stack.Screen name="UsersAdmin" component={UsersAdminScreen} />
            <Stack.Screen name="UserDetail" component={UserDetailScreen} />
            <Stack.Screen name="EmployeesAdmin" component={EmployeesAdminScreen} />
            <Stack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} />
            <Stack.Screen name="ConsultantsAdmin" component={ConsultantsAdminScreen} />
            <Stack.Screen name="StoresAdmin" component={StoresAdminScreen} />
            <Stack.Screen name="AccessProfilesAdmin" component={AccessProfilesAdminScreen} />
            <Stack.Screen name="AccessProfileDetail" component={AccessProfileDetailScreen} />
            <Stack.Screen name="BrandsAdmin" component={BrandsAdminScreen} />
            <Stack.Screen name="VehicleModelsAdmin" component={VehicleModelsAdminScreen} />
            <Stack.Screen name="ServicesAdmin" component={ServicesAdminScreen} />
            <Stack.Screen name="SuppliersAdmin" component={SuppliersAdminScreen} />
            <Stack.Screen name="DealershipsAdmin" component={DealershipsAdminScreen} />
        </Stack.Navigator>
    );
}
