import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui';
import {
    authenticate,
    getBiometricLabel,
    isBiometricAvailable,
    type BiometricLabel,
} from '@/services/biometrics';
import { useSettingsStore, type ThemePreference } from '@/stores/settings.store';
import { useStores } from '@/hooks/useStores';
import { brand, neutral } from '@/theme/tokens';
import type { AppStackScreenProps } from '@/navigation/types';

/**
 * SettingsScreen (Sprint 7 — HARD-04).
 *
 * Preferências do app: aparência (tema), notificações push, segurança (biometria
 * — "Em breve", ligada na Fatia 1b), loja padrão e "Sobre" (versão/build).
 * Todas as escolhas são persistidas em `settings.store`.
 */

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'system', label: 'Sistema', icon: 'phone-portrait-outline' },
    { value: 'light', label: 'Claro', icon: 'sunny-outline' },
    { value: 'dark', label: 'Escuro', icon: 'moon-outline' },
];

/** Título de seção padrão. */
function SectionTitle({ children }: { children: string }) {
    return (
        <Text className="mb-2 ml-1 font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
            {children}
        </Text>
    );
}

/** Linha com rótulo + descrição opcional + slot à direita (Switch, valor…). */
function SettingsRow({
    label,
    description,
    right,
    isLast,
}: {
    label: string;
    description?: string;
    right?: React.ReactNode;
    isLast?: boolean;
}) {
    return (
        <View
            className={`flex-row items-center gap-3 px-1 py-3 ${
                isLast ? '' : 'border-b border-neutral-100 dark:border-dark-border-soft'
            }`}
        >
            <View className="flex-1">
                <Text className="font-sans-semibold text-base text-neutral-800 dark:text-dark-text">
                    {label}
                </Text>
                {description ? (
                    <Text className="mt-0.5 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {description}
                    </Text>
                ) : null}
            </View>
            {right}
        </View>
    );
}

export function SettingsScreen({ navigation }: AppStackScreenProps<'Settings'>) {
    const themePreference = useSettingsStore((s) => s.themePreference);
    const setThemePreference = useSettingsStore((s) => s.setThemePreference);
    const pushEnabled = useSettingsStore((s) => s.pushEnabled);
    const setPushEnabled = useSettingsStore((s) => s.setPushEnabled);
    const biometricEnabled = useSettingsStore((s) => s.biometricEnabled);
    const setBiometricEnabled = useSettingsStore((s) => s.setBiometricEnabled);
    const setDefaultStoreId = useSettingsStore((s) => s.setDefaultStoreId);
    const defaultStoreId = useSettingsStore((s) => s.defaultStoreId);

    const toast = useToast();
    const { stores, isMultiStore, selectStore } = useStores();

    // Disponibilidade de biometria neste aparelho (hardware + cadastro). Checada
    // no mount; indisponível → linha desabilitada com legenda explicativa.
    const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
    const [biometricLabel, setBiometricLabel] = useState<BiometricLabel>('Biometria');
    const [biometricBusy, setBiometricBusy] = useState(false);

    useEffect(() => {
        let active = true;
        (async () => {
            const available = await isBiometricAvailable();
            if (!active) return;
            setBiometricAvailable(available);
            if (available) {
                const label = await getBiometricLabel();
                if (active) setBiometricLabel(label);
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    const toggleBiometric = async (value: boolean) => {
        if (biometricBusy) return;
        if (!value) {
            // Desligar é imediato.
            setBiometricEnabled(false);
            return;
        }
        // Ligar: exige disponibilidade + confirmação por biometria.
        if (!biometricAvailable) {
            toast.error('Biometria não disponível neste aparelho');
            return;
        }
        setBiometricBusy(true);
        try {
            const ok = await authenticate('Confirme para ativar o desbloqueio por biometria');
            if (ok) {
                setBiometricEnabled(true);
                toast.success('Desbloqueio por biometria ativado');
            } else {
                toast.error('Não foi possível confirmar sua biometria');
            }
        } finally {
            setBiometricBusy(false);
        }
    };

    // Legenda dinâmica conforme disponibilidade/tipo.
    const biometricDescription =
        biometricAvailable === false
            ? 'Não disponível neste aparelho'
            : biometricAvailable === null
              ? 'Verificando disponibilidade…'
              : biometricLabel === 'Rosto'
                ? 'Use o reconhecimento facial para abrir o app'
                : biometricLabel === 'Digital'
                  ? 'Use sua digital para abrir o app'
                  : 'Use sua biometria para abrir o app';

    const version = Constants.expoConfig?.version ?? '—';
    // build number (iOS) / versionCode (Android), quando disponível no manifest.
    const buildNumber =
        Constants.expoConfig?.ios?.buildNumber ??
        Constants.expoConfig?.android?.versionCode ??
        null;

    const chooseTheme = (value: ThemePreference) => setThemePreference(value);

    const togglePush = (value: boolean) => {
        // TODO(Fatia futura): integrar com o PushProvider para registrar/des-registrar
        // o token de push (expo-notifications) conforme esta preferência. Por ora só
        // persiste a escolha do usuário. Ver src/providers/PushProvider.tsx.
        setPushEnabled(value);
    };

    const chooseDefaultStore = (id: number | null) => {
        setDefaultStoreId(id);
        // Aplica imediatamente à seleção global.
        selectStore(id);
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Configurações" onBack={() => navigation.goBack()} />

            <ScrollView contentContainerStyle={{ padding: 16 }}>
                {/* Aparência */}
                <SectionTitle>Aparência</SectionTitle>
                <Card className="mb-5">
                    <Text className="mb-3 font-sans-semibold text-base text-neutral-800 dark:text-dark-text">
                        Tema
                    </Text>
                    <View className="gap-2">
                        {THEME_OPTIONS.map((opt) => {
                            const active = themePreference === opt.value;
                            return (
                                <Pressable
                                    key={opt.value}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={`Tema ${opt.label}`}
                                    onPress={() => chooseTheme(opt.value)}
                                    className={`min-h-[44px] flex-row items-center gap-3 rounded-xl border px-3 py-2.5 active:opacity-80 ${
                                        active
                                            ? 'border-brand bg-brand/10 dark:border-brand'
                                            : 'border-neutral-150 dark:border-dark-border'
                                    }`}
                                >
                                    <Ionicons
                                        name={opt.icon}
                                        size={20}
                                        color={active ? brand.DEFAULT : neutral[400]}
                                    />
                                    <Text
                                        className={`flex-1 font-sans-medium text-base ${
                                            active
                                                ? 'text-neutral-900 dark:text-dark-text'
                                                : 'text-neutral-600 dark:text-dark-text-muted'
                                        }`}
                                    >
                                        {opt.label}
                                    </Text>
                                    {active ? (
                                        <Ionicons
                                            name="checkmark-circle"
                                            size={20}
                                            color={brand.DEFAULT}
                                        />
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </View>
                </Card>

                {/* Notificações */}
                <SectionTitle>Notificações</SectionTitle>
                <Card className="mb-5">
                    <SettingsRow
                        label="Notificações push"
                        description="Receber alertas e avisos no aparelho"
                        isLast
                        right={
                            <Switch
                                accessibilityRole="switch"
                                accessibilityLabel="Notificações push"
                                accessibilityState={{ checked: pushEnabled }}
                                value={pushEnabled}
                                onValueChange={togglePush}
                                trackColor={{ false: neutral[200], true: brand.DEFAULT }}
                                thumbColor={pushEnabled ? brand.black : neutral[50]}
                                ios_backgroundColor={neutral[200]}
                            />
                        }
                    />
                </Card>

                {/* Segurança */}
                <SectionTitle>Segurança</SectionTitle>
                <Card className="mb-5">
                    <SettingsRow
                        label="Desbloqueio por biometria"
                        description={biometricDescription}
                        isLast
                        right={
                            <Switch
                                accessibilityRole="switch"
                                accessibilityLabel="Desbloqueio por biometria"
                                accessibilityState={{
                                    checked: biometricEnabled,
                                    disabled: biometricAvailable === false || biometricBusy,
                                }}
                                value={biometricEnabled}
                                onValueChange={toggleBiometric}
                                disabled={biometricAvailable === false || biometricBusy}
                                trackColor={{ false: neutral[200], true: brand.DEFAULT }}
                                thumbColor={biometricEnabled ? brand.black : neutral[50]}
                                ios_backgroundColor={neutral[200]}
                            />
                        }
                    />
                </Card>

                {/* Loja padrão — só quando há mais de uma loja acessível. */}
                {isMultiStore ? (
                    <>
                        <SectionTitle>Loja padrão</SectionTitle>
                        <Card className="mb-5">
                            <Text className="mb-3 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                                Loja aberta por padrão ao iniciar o app.
                            </Text>
                            <View className="gap-1">
                                <StoreOption
                                    label="Todas as Lojas"
                                    active={defaultStoreId === null}
                                    onPress={() => chooseDefaultStore(null)}
                                />
                                {stores.map((s) => (
                                    <StoreOption
                                        key={s.id}
                                        label={s.name}
                                        active={defaultStoreId === s.id}
                                        onPress={() => chooseDefaultStore(s.id)}
                                    />
                                ))}
                            </View>
                        </Card>
                    </>
                ) : null}

                {/* Sobre */}
                <SectionTitle>Sobre</SectionTitle>
                <Card>
                    <SettingsRow
                        label="Versão"
                        isLast
                        right={
                            <Text className="font-sans-medium text-base text-neutral-500 dark:text-dark-text-muted">
                                {buildNumber ? `${version} (${buildNumber})` : version}
                            </Text>
                        }
                    />
                </Card>
            </ScrollView>
        </View>
    );
}

function StoreOption({
    label,
    active,
    onPress,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Loja padrão: ${label}`}
            onPress={onPress}
            className="min-h-[44px] flex-row items-center justify-between rounded-xl px-2 py-2.5 active:opacity-70"
        >
            <Text
                className={`flex-1 font-sans-medium text-base ${
                    active
                        ? 'text-neutral-900 dark:text-dark-text'
                        : 'text-neutral-600 dark:text-dark-text-muted'
                }`}
            >
                {label}
            </Text>
            {active ? (
                <Ionicons name="checkmark-circle" size={20} color={brand.DEFAULT} />
            ) : null}
        </Pressable>
    );
}
