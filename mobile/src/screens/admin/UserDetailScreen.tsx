import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import {
    useUser,
    useActivateUser,
    useDeactivateUser,
    useResetUserPassword,
} from '@/hooks/useUsers';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { formatDateTimeBR } from '@/utils/formatDate';
import type { User } from '@/types/user.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Detalhe do usuário (Admin — Fatia 5a). Dados + ações gated por `useCanEdit`:
 *  - Ativar/Desativar (conforme is_active), com confirmação em Alert.
 *  - Reset de senha → exibe a senha temporária num painel copiável (expo-clipboard).
 */

/**
 * Carrega `expo-clipboard` de forma tardia e segura. O módulo nativo `ExpoClipboard`
 * pode não existir no binário (build feito antes de instalá-lo). Sondamos com
 * `requireOptionalNativeModule` (não lança nem dispara RedBox em dev) antes de
 * carregar o wrapper JS; se ausente, degrada com aviso (a senha segue selecionável).
 */
type ClipboardModule = typeof import('expo-clipboard');
function getClipboard(): ClipboardModule | null {
    try {
        if (!requireOptionalNativeModule('ExpoClipboard')) return null;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('expo-clipboard') as ClipboardModule;
    } catch {
        return null;
    }
}

function roleLabel(role: User['role']): string {
    return role === 'owner' ? 'Proprietário' : 'Usuário';
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
    return (
        <View className="flex-row items-start justify-between border-b border-neutral-50 py-2.5 dark:border-dark-border-soft">
            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text
                className="ml-4 flex-1 text-right font-sans-medium text-sm text-neutral-800 dark:text-dark-text"
                numberOfLines={2}
            >
                {value ?? '—'}
            </Text>
        </View>
    );
}

export function UserDetailScreen({ route, navigation }: AdminStackScreenProps<'UserDetail'>) {
    const { id } = route.params;
    const canEdit = useCanEdit('users');
    const toast = useToast();

    const { data: user, isLoading, isError, refetch } = useUser(id);
    const activate = useActivateUser();
    const deactivate = useDeactivateUser();
    const resetPassword = useResetUserPassword();

    const [tempPassword, setTempPassword] = useState<string | null>(null);

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Usuário" onBack={() => navigation.goBack()} />
                <View className="gap-4 p-4">
                    <Skeleton width="100%" height={120} />
                    <Skeleton width="100%" height={80} />
                </View>
            </View>
        );
    }

    if (isError || !user) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Usuário" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const busy = activate.isPending || deactivate.isPending || resetPassword.isPending;

    const confirmToggle = () => {
        if (user.is_active) {
            Alert.alert('Desativar usuário', `Desativar ${user.full_name}?`, [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Desativar',
                    style: 'destructive',
                    onPress: () => deactivate.mutate(user.id),
                },
            ]);
        } else {
            Alert.alert('Ativar usuário', `Ativar ${user.full_name}?`, [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Ativar', onPress: () => activate.mutate(user.id) },
            ]);
        }
    };

    const confirmResetPassword = () => {
        Alert.alert(
            'Redefinir senha',
            `Gerar uma nova senha temporária para ${user.full_name}? A senha atual deixará de funcionar.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Redefinir',
                    style: 'destructive',
                    onPress: () =>
                        resetPassword.mutate(user.id, {
                            onSuccess: (data) => setTempPassword(data.temporary_password),
                        }),
                },
            ]
        );
    };

    const copyPassword = async () => {
        if (!tempPassword) return;
        const Clipboard = getClipboard();
        if (!Clipboard) {
            toast.error('Cópia indisponível neste app. Selecione a senha e copie manualmente.');
            return;
        }
        await Clipboard.setStringAsync(tempPassword);
        toast.success('Senha copiada.');
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={user.full_name}
                subtitle={user.email}
                onBack={() => navigation.goBack()}
                right={
                    <Badge
                        variant={user.is_active ? 'success' : 'neutral'}
                        size="sm"
                        label={user.is_active ? 'Ativo' : 'Inativo'}
                    />
                }
            />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                <Card>
                    <Text className="mb-1 font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                        Dados
                    </Text>
                    <InfoRow label="Cargo" value={roleLabel(user.role)} />
                    <InfoRow label="E-mail" value={user.email} />
                    <InfoRow label="Telefone" value={user.phone} />
                    <InfoRow label="Loja" value={user.store_name} />
                    <InfoRow
                        label="Último acesso"
                        value={user.last_login ? formatDateTimeBR(user.last_login) : 'Nunca acessou'}
                    />
                    <InfoRow label="Criado em" value={formatDateTimeBR(user.created_at)} />
                </Card>

                {tempPassword ? (
                    <Card className="mt-4 border-brand/40">
                        <View className="flex-row items-center gap-2">
                            <Ionicons name="key" size={18} color="#D47F00" />
                            <Text className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text">
                                Senha temporária
                            </Text>
                        </View>
                        <Text className="mt-1 font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                            Compartilhe com o usuário. Ele deverá trocá-la no primeiro acesso.
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Copiar senha temporária"
                            onPress={copyPassword}
                            className="mt-3 flex-row items-center justify-between rounded-xl bg-neutral-100 px-4 py-3 active:opacity-80 dark:bg-dark-elevated"
                        >
                            <Text
                                selectable
                                className="text-lg tracking-widest text-neutral-900 dark:text-dark-text"
                                style={{ fontVariant: ['tabular-nums'] }}
                            >
                                {tempPassword}
                            </Text>
                            <Ionicons name="copy-outline" size={20} color="#667085" />
                        </Pressable>
                    </Card>
                ) : null}

                {canEdit ? (
                    <View className="mt-6 gap-3">
                        <Button
                            title={user.is_active ? 'Desativar usuário' : 'Ativar usuário'}
                            variant={user.is_active ? 'destructive' : 'primary'}
                            icon={user.is_active ? 'close-circle-outline' : 'checkmark-circle-outline'}
                            loading={activate.isPending || deactivate.isPending}
                            disabled={busy}
                            onPress={confirmToggle}
                        />
                        <Button
                            title="Redefinir senha"
                            variant="secondary"
                            icon="key-outline"
                            loading={resetPassword.isPending}
                            disabled={busy}
                            onPress={confirmResetPassword}
                        />
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}
