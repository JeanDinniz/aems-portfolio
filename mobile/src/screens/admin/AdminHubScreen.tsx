import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { useCanView } from '@/hooks/useMyPermissions';
import { useAuthStore } from '@/stores/auth.store';
import { ADMIN_CADASTROS_ENABLED } from '@/constants/features';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Hub de Administração (Fatia 5a). Lista de atalhos por módulo, cada um gated por
 * `useCanView(submódulo)` (a autorização real é do backend; o gate aqui é só UX).
 *
 * Visual no molde do `MoreScreen` (`Shortcut` com ícone + label + descrição +
 * chevron). A 5b acrescentará Brands/Vehicle Models/Services/Suppliers/Dealerships.
 */

interface ShortcutProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    description?: string;
    onPress?: () => void;
}

function Shortcut({ icon, label, description, onPress }: ShortcutProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="flex-row items-center gap-3 border-b border-neutral-50 px-4 py-3.5 active:bg-neutral-50 dark:border-dark-border-soft dark:active:bg-dark-elevated"
        >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 dark:bg-dark-elevated">
                <Ionicons name={icon} size={20} color="#667085" />
            </View>
            <View className="flex-1">
                <Text className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text">
                    {label}
                </Text>
                {description ? (
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {description}
                    </Text>
                ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
        </Pressable>
    );
}

export function AdminHubScreen({ navigation }: AdminStackScreenProps<'AdminHub'>) {
    const isOwner = useAuthStore((s) => s.isOwner)();
    const canViewUsers = useCanView('users');
    const canViewEmployees = useCanView('employees');
    const canViewConsultants = useCanView('consultants');
    const canViewStores = useCanView('stores');
    const canViewProfiles = useCanView('profiles');
    const canViewBrands = useCanView('brands');
    const canViewModels = useCanView('models');
    const canViewServices = useCanView('services');
    const canViewTimeClockMirror = useCanView('time_clock_mirror');

    // Cadastros puros — só aparecem com a flag ligada (default OFF). Faltas do Dia,
    // Feriados e Espelho de Ponto NÃO usam a flag (seguem só por permissão).
    const showUsers = ADMIN_CADASTROS_ENABLED && canViewUsers;
    const showEmployeesRegistry = ADMIN_CADASTROS_ENABLED && canViewEmployees; // ficha de funcionários (cadastro)
    const showConsultants = ADMIN_CADASTROS_ENABLED && canViewConsultants;
    const showStoresRegistry = ADMIN_CADASTROS_ENABLED && canViewStores; // cadastro de lojas
    const showProfiles = ADMIN_CADASTROS_ENABLED && canViewProfiles;
    const showBrands = ADMIN_CADASTROS_ENABLED && canViewBrands;
    const showModels = ADMIN_CADASTROS_ENABLED && canViewModels;
    const showServices = ADMIN_CADASTROS_ENABLED && canViewServices;
    const showSuppliers = ADMIN_CADASTROS_ENABLED && isOwner;
    const showDealerships = ADMIN_CADASTROS_ENABLED && isOwner;
    const showAudit = ADMIN_CADASTROS_ENABLED && isOwner;

    const anyVisible =
        showUsers ||
        showEmployeesRegistry ||
        showConsultants ||
        showStoresRegistry ||
        showProfiles ||
        showBrands ||
        showModels ||
        showServices ||
        showSuppliers ||
        showDealerships ||
        showAudit ||
        // Sempre disponíveis (por permissão), independentes da flag de cadastros:
        canViewEmployees || // Faltas do Dia
        canViewStores || // Feriados
        canViewTimeClockMirror; // Espelho de Ponto

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title="Administração"
                subtitle="Cadastros e acessos"
                onBack={() => navigation.goBack()}
            />

            <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
                <View className="mx-4 overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
                    {showUsers ? (
                        <Shortcut
                            icon="people-outline"
                            label="Usuários"
                            description="Ativar/desativar e resetar senha"
                            onPress={() => navigation.navigate('UsersAdmin')}
                        />
                    ) : null}
                    {showEmployeesRegistry ? (
                        <Shortcut
                            icon="id-card-outline"
                            label="Funcionários"
                            description="Ficha, indicadores e movimentações"
                            onPress={() => navigation.navigate('EmployeesAdmin')}
                        />
                    ) : null}
                    {canViewEmployees ? (
                        <Shortcut
                            icon="calendar-outline"
                            label="Faltas do Dia"
                            description="Presença por loja e dia; marcar falta"
                            onPress={() => navigation.navigate('DayAbsencesAdmin')}
                        />
                    ) : null}
                    {canViewTimeClockMirror ? (
                        <Shortcut
                            icon="finger-print-outline"
                            label="Espelho de Ponto"
                            description="Batidas com selfie, distância e geofence"
                            onPress={() => navigation.navigate('TimeClockMirrorAdmin')}
                        />
                    ) : null}
                    {showConsultants ? (
                        <Shortcut
                            icon="briefcase-outline"
                            label="Consultores"
                            description="Consultar e exportar Excel"
                            onPress={() => navigation.navigate('ConsultantsAdmin')}
                        />
                    ) : null}
                    {showStoresRegistry ? (
                        <Shortcut
                            icon="storefront-outline"
                            label="Lojas"
                            description="Ativar/desativar lojas"
                            onPress={() => navigation.navigate('StoresAdmin')}
                        />
                    ) : null}
                    {canViewStores ? (
                        <Shortcut
                            icon="calendar-clear-outline"
                            label="Feriados"
                            description="Feriados nacionais, estaduais e por loja"
                            onPress={() => navigation.navigate('HolidaysAdmin')}
                        />
                    ) : null}
                    {showProfiles ? (
                        <Shortcut
                            icon="key-outline"
                            label="Perfis de acesso"
                            description="Permissões e usuários vinculados"
                            onPress={() => navigation.navigate('AccessProfilesAdmin')}
                        />
                    ) : null}
                    {showBrands ? (
                        <Shortcut
                            icon="pricetags-outline"
                            label="Marcas"
                            description="Ativar/desativar marcas de veículos"
                            onPress={() => navigation.navigate('BrandsAdmin')}
                        />
                    ) : null}
                    {showModels ? (
                        <Shortcut
                            icon="car-outline"
                            label="Modelos"
                            description="Modelos de veículos por marca"
                            onPress={() => navigation.navigate('VehicleModelsAdmin')}
                        />
                    ) : null}
                    {showServices ? (
                        <Shortcut
                            icon="construct-outline"
                            label="Serviços"
                            description="Catálogo de serviços por departamento"
                            onPress={() => navigation.navigate('ServicesAdmin')}
                        />
                    ) : null}
                    {showSuppliers ? (
                        <Shortcut
                            icon="cube-outline"
                            label="Fornecedores"
                            description="Ativar/desativar fornecedores"
                            onPress={() => navigation.navigate('SuppliersAdmin')}
                        />
                    ) : null}
                    {showDealerships ? (
                        <Shortcut
                            icon="business-outline"
                            label="Concessionárias"
                            description="Ativar/desativar concessionárias"
                            onPress={() => navigation.navigate('DealershipsAdmin')}
                        />
                    ) : null}
                    {showAudit ? (
                        <Shortcut
                            icon="shield-checkmark-outline"
                            label="Auditoria"
                            description="Trilha de ações do sistema"
                            onPress={() => navigation.navigate('AuditAdmin')}
                        />
                    ) : null}
                </View>

                {!anyVisible ? (
                    <View className="mx-4 mt-6 items-center rounded-2xl border border-neutral-100 bg-white px-6 py-10 dark:border-dark-border-soft dark:bg-dark-surface">
                        <Ionicons name="lock-closed-outline" size={32} color="#98A2B3" />
                        <Text className="mt-3 text-center font-sans-semibold text-base text-neutral-700 dark:text-dark-text">
                            Acesso restrito
                        </Text>
                        <Text className="mt-1 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Você não tem permissão para acessar os módulos administrativos.
                        </Text>
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}
