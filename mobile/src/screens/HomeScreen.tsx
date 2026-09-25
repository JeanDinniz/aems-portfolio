import type { ComponentProps } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { StoreSelector } from '@/components/common/StoreSelector';
import { useAuthStore } from '@/stores/auth.store';
import { useMyPermissions, useCanView } from '@/hooks/useMyPermissions';
import { useStores } from '@/hooks/useStores';
import { useUnreadCount } from '@/hooks/useNotifications';
import { useTimeClockMe } from '@/hooks/useTimeClock';
import { useVisibleModules } from '@/navigation/guards';
import { greetingForHour, formatWeekdayLong } from '@/utils/formatDate';
import type { AppTabScreenProps } from '@/navigation/types';

/**
 * HOME-01 — Home-hub fiel ao Figma `01-home-dashboard.png`.
 *
 * Estrutura: header preto arredondado embaixo (logo + saudação + sino + avatar),
 * grade 2×2 de indicadores (placeholders — ligar analytics é Sprint 6) e cards
 * grandes de módulo renderizados condicionalmente por permissão (useVisibleModules).
 *
 * Mantém o bootstrap pós-login (permissões + lojas) e o StoreSelector acessível.
 */

const logoMark = require('../../assets/brand/icon-dark.png');

/** Mapeia a chave do módulo (guard) → rota + visual do card grande. */
interface ModuleCardConfig {
    key: string;
    route: 'ServiceOrders' | 'Scheduling' | 'TimeClock';
    title: string;
    description: string;
    icon: ComponentProps<typeof Ionicons>['name'];
    /** true = card âmbar (texto escuro); false = card preto (texto claro). */
    amber: boolean;
}

const MODULE_CARDS: ModuleCardConfig[] = [
    {
        key: 'service_orders',
        route: 'ServiceOrders',
        title: 'Ordens de Serviço',
        description: 'Histórico e lançamento de ordens de serviço',
        icon: 'clipboard-outline',
        amber: true,
    },
    {
        key: 'scheduling',
        route: 'Scheduling',
        title: 'Agendamentos',
        description: 'Ordens de serviço agendadas',
        icon: 'calendar-outline',
        amber: false,
    },
];

/** Card do Ponto Eletrônico — visual próprio (renderizado à parte por depender do vínculo). */
const TIME_CLOCK_CARD: ModuleCardConfig = {
    key: 'time_clock',
    route: 'TimeClock',
    title: 'Ponto',
    description: 'Bater ponto de entrada e saída',
    icon: 'finger-print-outline',
    amber: false,
};

export function HomeScreen({ navigation }: AppTabScreenProps<'Inicio'>) {
    const user = useAuthStore((s) => s.user);

    // Bootstrap pós-login: dispara as queries de permissões e lojas.
    useMyPermissions();
    useStores();

    const { data: unreadCount = 0 } = useUnreadCount();

    const modules = useVisibleModules();
    const visibleKeys = new Set(modules.map((m) => m.key));
    const moduleCards = MODULE_CARDS.filter((c) => visibleKeys.has(c.key));

    // Ponto Eletrônico: card visível com permissão `time_clock` E vínculo com
    // funcionário. A query `me` fica em cache; se `employee_id === null`
    // (usuário sem vínculo) o card fica escondido. Enquanto carrega, não mostra
    // (evita piscar um card que some depois).
    const canViewTimeClock = useCanView('time_clock');
    const { data: timeClockMe } = useTimeClockMe();
    const showTimeClock = canViewTimeClock && !!timeClockMe && timeClockMe.employee_id !== null;

    const firstName = user?.full_name?.trim().split(/\s+/)[0] ?? '';
    const initials = (user?.full_name ?? '')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p.charAt(0).toUpperCase())
        .join('');

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            {/* Header preto arredondado embaixo */}
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="px-5 pb-7 pt-2">
                    {/* Linha de marca + ações */}
                    <View className="mb-5 flex-row items-center justify-between">
                        <View className="flex-row items-center gap-2.5">
                            <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand">
                                <Image
                                    source={logoMark}
                                    style={{ width: 24, height: 24 }}
                                    resizeMode="contain"
                                />
                            </View>
                            <View>
                                <Text className="font-sans text-[10px] uppercase tracking-widest text-neutral-400">
                                    Sistema
                                </Text>
                                <Text className="font-display-bold text-base text-white">
                                    Wash Control
                                </Text>
                            </View>
                        </View>

                        <View className="flex-row items-center gap-3">
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                    unreadCount > 0
                                        ? `Notificações, ${unreadCount} não lidas`
                                        : 'Notificações'
                                }
                                onPress={() => navigation.navigate('Notifications')}
                                className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                            >
                                <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
                                {unreadCount > 0 ? (
                                    <View className="absolute -right-0.5 -top-0.5 h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1">
                                        <Text className="font-sans-bold text-[11px] text-brand-black">
                                            {unreadCount > 99 ? '99+' : unreadCount}
                                        </Text>
                                    </View>
                                ) : null}
                            </Pressable>

                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Abrir perfil"
                                onPress={() => navigation.navigate('Profile')}
                                className="h-11 w-11 items-center justify-center rounded-full bg-brand active:opacity-80"
                            >
                                <Text className="font-sans-bold text-sm text-brand-black">
                                    {initials || '?'}
                                </Text>
                            </Pressable>
                        </View>
                    </View>

                    {/* Saudação */}
                    <Text className="font-sans text-sm text-neutral-400">
                        {`${greetingForHour()},`}
                    </Text>
                    <Text className="font-display-bold text-2xl text-white">
                        {firstName || 'bem-vindo'}
                    </Text>
                    <Text className="mt-0.5 font-sans text-sm capitalize text-neutral-400">
                        {formatWeekdayLong()}
                    </Text>
                </View>
            </SafeAreaView>

            <ScrollView
                className="-mt-4 flex-1 rounded-t-3xl bg-neutral-50 dark:bg-dark-bg"
                contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Seletor de loja (acessível logo abaixo do header) */}
                <View className="mb-4 flex-row items-center justify-between">
                    <Text className="font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                        Loja
                    </Text>
                    <StoreSelector />
                </View>

                {/* Cards grandes de módulo (condicionais por permissão) */}
                <View className="gap-4">
                    {moduleCards.length === 0 && !showTimeClock ? (
                        <Text className="py-6 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Nenhum módulo disponível para o seu perfil.
                        </Text>
                    ) : (
                        <>
                            {moduleCards.map((card) => (
                                <ModuleCard
                                    key={card.key}
                                    config={card}
                                    onPress={() => navigation.navigate(card.route)}
                                />
                            ))}
                            {showTimeClock ? (
                                <ModuleCard
                                    key={TIME_CLOCK_CARD.key}
                                    config={TIME_CLOCK_CARD}
                                    onPress={() => navigation.navigate('TimeClock')}
                                />
                            ) : null}
                        </>
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

interface ModuleCardProps {
    config: ModuleCardConfig;
    onPress: () => void;
}

function ModuleCard({ config, onPress }: ModuleCardProps) {
    const { amber, title, description, icon } = config;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint={description}
            onPress={onPress}
            className={`min-h-[150px] justify-center rounded-2xl p-5 shadow-sm active:opacity-90 ${
                amber ? 'bg-brand' : 'bg-brand-black'
            }`}
        >
            <View className="flex-row items-center gap-4">
                <View
                    className={`h-14 w-14 items-center justify-center rounded-2xl ${
                        amber ? 'bg-black/10' : 'bg-white/10'
                    }`}
                >
                    <Ionicons
                        name={icon}
                        size={26}
                        color={amber ? '#1A1A1A' : '#F5B800'}
                    />
                </View>
                <View className="flex-1">
                    <Text
                        className={`font-display-bold text-xl ${
                            amber ? 'text-brand-black' : 'text-white'
                        }`}
                    >
                        {title}
                    </Text>
                    <Text
                        className={`mt-1 font-sans text-sm ${
                            amber ? 'text-brand-black/70' : 'text-neutral-400'
                        }`}
                    >
                        {description}
                    </Text>
                </View>
                <Ionicons
                    name="chevron-forward"
                    size={22}
                    color={amber ? '#1A1A1A' : '#999999'}
                />
            </View>
        </Pressable>
    );
}
