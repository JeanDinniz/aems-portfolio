import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import {
    useAccessProfile,
    useToggleAccessProfileActive,
    useRemoveProfileUser,
} from '@/hooks/useAccessProfiles';
import { useUsersList } from '@/hooks/useUsers';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { SUB_MODULE_LABELS, SUB_MODULE_ORDER } from '@/constants/access-profiles';
import type { ModulePermission } from '@/types/accessProfile.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Detalhe do perfil de acesso (Admin — Fatia 5a).
 *
 * - Matriz de permissões READ-ONLY (submódulo × view/edit/delete). Só mostramos
 *   os submódulos com ao menos uma permissão marcada.
 * - Usuários vinculados (nomes resolvidos via `useUsersList`) com botão Remover.
 * - Ativar/Desativar o perfil. Tudo gated por `useCanEdit('profiles')`.
 *
 * Adicionar usuário NÃO está no escopo (fica para v2).
 */

function PermCell({ on }: { on: boolean }) {
    return (
        <View className="w-16 items-center">
            <Ionicons
                name={on ? 'checkmark-circle' : 'remove-circle-outline'}
                size={18}
                color={on ? '#12B76A' : '#D0D5DD'}
            />
        </View>
    );
}

function PermissionMatrix({ permissions }: { permissions: ModulePermission[] }) {
    const byModule = useMemo(() => {
        const map = new Map<string, ModulePermission>();
        for (const p of permissions) map.set(p.sub_module, p);
        return map;
    }, [permissions]);

    const rows = SUB_MODULE_ORDER.map((sub) => byModule.get(sub)).filter(
        (p): p is ModulePermission => !!p && (p.can_view || p.can_edit || p.can_delete)
    );

    if (rows.length === 0) {
        return (
            <Text className="py-4 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                Nenhuma permissão concedida.
            </Text>
        );
    }

    return (
        <View>
            {/* Cabeçalho */}
            <View className="flex-row items-center border-b border-neutral-100 pb-2 dark:border-dark-border-soft">
                <Text className="flex-1 font-sans-semibold text-xs text-neutral-400 dark:text-dark-text-muted">
                    Módulo
                </Text>
                <Text className="w-16 text-center font-sans-semibold text-xs text-neutral-400 dark:text-dark-text-muted">
                    Ver
                </Text>
                <Text className="w-16 text-center font-sans-semibold text-xs text-neutral-400 dark:text-dark-text-muted">
                    Editar
                </Text>
                <Text className="w-16 text-center font-sans-semibold text-xs text-neutral-400 dark:text-dark-text-muted">
                    Excluir
                </Text>
            </View>
            {rows.map((p) => (
                <View
                    key={p.sub_module}
                    className="flex-row items-center border-b border-neutral-50 py-2.5 dark:border-dark-border-soft"
                >
                    <Text className="flex-1 font-sans-medium text-sm text-neutral-800 dark:text-dark-text">
                        {SUB_MODULE_LABELS[p.sub_module] ?? p.sub_module}
                    </Text>
                    <PermCell on={p.can_view} />
                    <PermCell on={p.can_edit} />
                    <PermCell on={p.can_delete} />
                </View>
            ))}
        </View>
    );
}

export function AccessProfileDetailScreen({
    route,
    navigation,
}: AdminStackScreenProps<'AccessProfileDetail'>) {
    const { id } = route.params;
    const canEdit = useCanEdit('profiles');

    const { data: profile, isLoading, isError, refetch } = useAccessProfile(id);
    // Resolve nomes dos usuários vinculados (o perfil só carrega user_ids).
    const { data: usersData } = useUsersList({}, 1);
    const toggle = useToggleAccessProfileActive();
    const removeUser = useRemoveProfileUser();

    const userNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const u of usersData?.users ?? []) map.set(String(u.id), u.full_name);
        return map;
    }, [usersData]);

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Perfil" onBack={() => navigation.goBack()} />
                <View className="gap-4 p-4">
                    <Skeleton width="100%" height={160} />
                    <Skeleton width="100%" height={100} />
                </View>
            </View>
        );
    }

    if (isError || !profile) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Perfil" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const confirmToggle = () => {
        const next = !profile.is_active;
        Alert.alert(
            next ? 'Ativar perfil' : 'Desativar perfil',
            `${next ? 'Ativar' : 'Desativar'} o perfil ${profile.name}?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: next ? 'Ativar' : 'Desativar',
                    style: next ? 'default' : 'destructive',
                    onPress: () => toggle.mutate({ id: profile.id, isActive: next }),
                },
            ]
        );
    };

    const confirmRemoveUser = (userId: string, name: string) => {
        Alert.alert('Remover usuário', `Remover ${name} deste perfil?`, [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Remover',
                style: 'destructive',
                onPress: () => removeUser.mutate({ id: profile.id, userId }),
            },
        ]);
    };

    const userIds = profile.user_ids ?? [];

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={profile.name}
                subtitle={profile.description ?? undefined}
                onBack={() => navigation.goBack()}
                right={
                    <Badge
                        variant={profile.is_active ? 'success' : 'neutral'}
                        size="sm"
                        label={profile.is_active ? 'Ativo' : 'Inativo'}
                    />
                }
            />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                {profile.is_galpon_profile || profile.hide_galpon_option ? (
                    <View className="mb-4 flex-row flex-wrap gap-2">
                        {profile.is_galpon_profile ? (
                            <Badge variant="brand" size="sm" label="Usuário Galpão" icon="cube-outline" />
                        ) : null}
                        {profile.hide_galpon_option ? (
                            <Badge variant="neutral" size="sm" label="Oculta Galpão" icon="eye-off-outline" />
                        ) : null}
                    </View>
                ) : null}

                <Card>
                    <Text className="mb-2 font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                        Permissões
                    </Text>
                    <PermissionMatrix permissions={profile.permissions ?? []} />
                </Card>

                <Card className="mt-4">
                    <Text className="mb-1 font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                        Usuários vinculados ({userIds.length})
                    </Text>
                    {userIds.length === 0 ? (
                        <Text className="py-4 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Nenhum usuário vinculado.
                        </Text>
                    ) : (
                        userIds.map((uid) => {
                            const name = userNameById.get(String(uid)) ?? `Usuário #${uid}`;
                            return (
                                <View
                                    key={uid}
                                    className="flex-row items-center justify-between border-b border-neutral-50 py-2.5 dark:border-dark-border-soft"
                                >
                                    <Text
                                        className="flex-1 font-sans-medium text-sm text-neutral-800 dark:text-dark-text"
                                        numberOfLines={1}
                                    >
                                        {name}
                                    </Text>
                                    {canEdit ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`Remover ${name}`}
                                            onPress={() => confirmRemoveUser(String(uid), name)}
                                            disabled={removeUser.isPending}
                                            hitSlop={8}
                                            className="ml-3 h-9 w-9 items-center justify-center rounded-full bg-error-light active:opacity-70"
                                        >
                                            <Ionicons name="trash-outline" size={16} color="#F04438" />
                                        </Pressable>
                                    ) : null}
                                </View>
                            );
                        })
                    )}
                </Card>

                {canEdit ? (
                    <View className="mt-6">
                        <Button
                            title={profile.is_active ? 'Desativar perfil' : 'Ativar perfil'}
                            variant={profile.is_active ? 'destructive' : 'primary'}
                            icon={profile.is_active ? 'close-circle-outline' : 'checkmark-circle-outline'}
                            loading={toggle.isPending}
                            onPress={confirmToggle}
                        />
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}
