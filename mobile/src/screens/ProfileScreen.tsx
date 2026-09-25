import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';

import { useConfirm } from '@/components/ui';
import { TextField } from '@/components/common/TextField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { authService } from '@/services/api/auth.service';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import type { AppStackScreenProps } from '@/navigation/types';

const schema = z.object({
    full_name: z.string().min(1, 'Informe o nome'),
});
type FormValues = z.infer<typeof schema>;

/**
 * ProfileScreen + logout (AUTH-06). Edita o nome; logout revoga e limpa tudo.
 * Telefone não é editável: o backend não tem coluna/persistência para `phone`.
 */
export function ProfileScreen({ navigation }: AppStackScreenProps<'Profile'>) {
    const user = useAuthStore((s) => s.user);
    const updateUser = useAuthStore((s) => s.updateUser);
    const { logout, isLoggingOut } = useAuth();
    const { confirm, alert } = useConfirm();

    const {
        control,
        handleSubmit,
        reset,
        formState: { errors, isDirty },
    } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { full_name: user?.full_name ?? '' },
    });

    // Sincroniza o formulário quando os dados do usuário mudam.
    useEffect(() => {
        reset({ full_name: user?.full_name ?? '' });
    }, [user?.full_name, reset]);

    const [saved, setSaved] = useState(false);

    const updateMutation = useMutation({
        mutationFn: (data: FormValues) => authService.updateProfile(data),
        onSuccess: (updated) => {
            updateUser({ full_name: updated.full_name });
            setSaved(true);
        },
        onError: (err) => {
            void alert({
                title: 'Erro',
                message: getApiErrorMessage(err as Error, 'Não foi possível salvar.'),
            });
        },
    });

    const onSubmit = (values: FormValues) => {
        Keyboard.dismiss();
        setSaved(false);
        updateMutation.mutate(values);
    };

    const confirmLogout = async () => {
        const ok = await confirm({
            title: 'Sair',
            message: 'Deseja encerrar a sessão?',
            confirmLabel: 'Sair',
            destructive: true,
        });
        if (ok) logout();
    };

    return (
        <SafeAreaView className="flex-1 bg-neutral-50" edges={['top', 'bottom']}>
            <ScrollView
                contentContainerClassName="px-5 py-6"
                keyboardShouldPersistTaps="handled"
            >
                <View className="mb-6 flex-row items-center justify-between">
                    <Text className="text-2xl font-extrabold text-neutral-900">Perfil</Text>
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => navigation.goBack()}
                        className="px-2 py-1 active:opacity-70"
                    >
                        <Text className="text-sm font-semibold text-primary-600">Voltar</Text>
                    </Pressable>
                </View>

                <View className="mb-5 rounded-2xl bg-white p-5">
                    <Text className="mb-1 text-sm text-neutral-400">E-mail</Text>
                    <Text className="mb-4 text-base font-medium text-neutral-800">
                        {user?.email}
                    </Text>

                    <Controller
                        control={control}
                        name="full_name"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                label="Nome completo"
                                value={value}
                                onChangeText={(t) => {
                                    onChange(t);
                                    setSaved(false);
                                }}
                                onBlur={onBlur}
                                error={errors.full_name?.message}
                                editable={!updateMutation.isPending}
                            />
                        )}
                    />

                    {saved ? (
                        <View className="mb-3 rounded-lg bg-success-light px-3 py-2">
                            <Text className="text-sm font-medium text-success">
                                Perfil atualizado.
                            </Text>
                        </View>
                    ) : null}

                    <PrimaryButton
                        title="Salvar alterações"
                        loading={updateMutation.isPending}
                        disabled={!isDirty}
                        onPress={handleSubmit(onSubmit)}
                    />
                </View>

                <View className="rounded-2xl bg-white p-5">
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => navigation.navigate('ChangePassword')}
                        className="border-b border-neutral-100 py-3 active:opacity-70"
                    >
                        <Text className="text-base font-medium text-neutral-700">
                            Alterar senha
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        onPress={confirmLogout}
                        disabled={isLoggingOut}
                        className="py-3 active:opacity-70"
                    >
                        <Text className="text-base font-semibold text-error">
                            {isLoggingOut ? 'Saindo...' : 'Sair'}
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}
