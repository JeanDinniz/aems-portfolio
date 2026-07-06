import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { StoreSelector } from '@/components/common/StoreSelector';
import { useAuthStore } from '@/stores/auth.store';
import { useCanView } from '@/hooks/useMyPermissions';
import { useGalponFlags } from '@/navigation/guards';
import type { AppTabScreenProps } from '@/navigation/types';

/**
 * Aba "Mais" — hub de atalhos secundários. Por ora: seletor de loja, atalho de
 * Perfil e itens futuros (Conferência/Fechamento/Notificações/Configurações)
 * marcados como "Em breve". Logout fica dentro do Perfil.
 */

interface ShortcutProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    description?: string;
    onPress?: () => void;
    disabled?: boolean;
}

function Shortcut({ icon, label, description, onPress, disabled }: ShortcutProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !!disabled }}
            onPress={onPress}
            disabled={disabled}
            className={`flex-row items-center gap-3 border-b border-neutral-50 px-4 py-3.5 active:bg-neutral-50 dark:border-dark-border-soft dark:active:bg-dark-elevated ${
                disabled ? 'opacity-50' : ''
            }`}
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
            {!disabled ? (
                <Ionicons name="chevron-forward" size={18} color="#98A2B3" />
            ) : (
                <Text className="font-sans-medium text-xs text-neutral-400 dark:text-dark-text-muted">
                    Em breve
                </Text>
            )}
        </Pressable>
    );
}

export function MoreScreen({ navigation }: AppTabScreenProps<'More'>) {
    const user = useAuthStore((s) => s.user);
    const isOwner = useAuthStore((s) => s.isOwner)();
    const { isGalponProfile } = useGalponFlags();
    const canViewConference = useCanView('conference');
    const canViewFechamento = useCanView('fechamento');
    const canViewDashboard = isOwner || isGalponProfile;

    // Administração: visível se Owner ou qualquer submódulo admin visível.
    const canViewUsers = useCanView('users');
    const canViewEmployees = useCanView('employees');
    const canViewConsultants = useCanView('consultants');
    const canViewStores = useCanView('stores');
    const canViewProfiles = useCanView('profiles');
    const canViewBrands = useCanView('brands');
    const canViewModels = useCanView('models');
    const canViewServices = useCanView('services');
    const canViewAdmin =
        isOwner ||
        canViewUsers ||
        canViewEmployees ||
        canViewConsultants ||
        canViewStores ||
        canViewProfiles ||
        canViewBrands ||
        canViewModels ||
        canViewServices;

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Mais" subtitle={user?.full_name ?? undefined} />

            <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
                <View className="mb-4 flex-row items-center justify-between px-4">
                    <Text className="font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                        Loja
                    </Text>
                    <StoreSelector />
                </View>

                <View className="mx-4 overflow-hidden rounded-2xl border border-neutral-100 bg-white dark:border-dark-border-soft dark:bg-dark-surface">
                    <Shortcut
                        icon="person-outline"
                        label="Perfil"
                        description="Dados da conta, senha e sair"
                        onPress={() => navigation.navigate('Profile')}
                    />
                    {canViewDashboard ? (
                        <Shortcut
                            icon="stats-chart-outline"
                            label="Dashboard"
                            description="Indicadores e rankings"
                            onPress={() => navigation.navigate('Dashboard')}
                        />
                    ) : null}
                    {canViewConference ? (
                        <Shortcut
                            icon="checkmark-done-outline"
                            label="Conferência"
                            description="Auditar O.S. finalizadas"
                            onPress={() => navigation.navigate('Conference')}
                        />
                    ) : null}
                    {canViewFechamento ? (
                        <Shortcut
                            icon="cash-outline"
                            label="Fechamento"
                            description="Fechamento mensal e exports"
                            onPress={() => navigation.navigate('Fechamento')}
                        />
                    ) : null}
                    <Shortcut
                        icon="notifications-outline"
                        label="Notificações"
                        description="Alertas e avisos"
                        onPress={() => navigation.navigate('Notifications')}
                    />
                    {canViewAdmin ? (
                        <Shortcut
                            icon="shield-checkmark-outline"
                            label="Administração"
                            description="Cadastros, usuários e acessos"
                            onPress={() => navigation.navigate('Admin', { screen: 'AdminHub' })}
                        />
                    ) : null}
                    <Shortcut
                        icon="settings-outline"
                        label="Configurações"
                        description="Tema, notificações e preferências"
                        onPress={() => navigation.navigate('Settings')}
                    />
                </View>
            </ScrollView>
        </View>
    );
}
