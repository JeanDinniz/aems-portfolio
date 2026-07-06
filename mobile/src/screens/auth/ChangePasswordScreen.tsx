import { useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { TextField } from '@/components/common/TextField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { authService } from '@/services/api/auth.service';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import type { AppStackScreenProps } from '@/navigation/types';

const schema = z
    .object({
        current_password: z.string().min(1, 'Informe a senha atual'),
        new_password: z
            .string()
            .min(8, 'Mínimo de 8 caracteres')
            .regex(/[A-Za-z]/, 'Inclua ao menos uma letra')
            .regex(/[0-9]/, 'Inclua ao menos um número'),
        confirm: z.string().min(1, 'Confirme a nova senha'),
    })
    .refine((d) => d.new_password === d.confirm, {
        message: 'As senhas não coincidem',
        path: ['confirm'],
    })
    .refine((d) => d.new_password !== d.current_password, {
        message: 'A nova senha deve ser diferente da atual',
        path: ['new_password'],
    });

type FormValues = z.infer<typeof schema>;

export function ChangePasswordScreen({ navigation }: AppStackScreenProps<'ChangePassword'>) {
    const mustChange = useAuthStore((s) => !!s.user?.must_change_password);
    const updateUser = useAuthStore((s) => s.updateUser);
    const { logout } = useAuth();
    const [submitting, setSubmitting] = useState(false);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { current_password: '', new_password: '', confirm: '' },
    });

    const onSubmit = async (values: FormValues) => {
        Keyboard.dismiss();
        setSubmitting(true);
        try {
            await authService.changePassword(values.current_password, values.new_password);
            if (mustChange) {
                // 1º acesso: encerra a sessão e volta ao login para entrar com a
                // nova senha. (clearAuth → RootNavigator mostra o AuthStack — mesma
                // reatividade do login, determinística.)
                Alert.alert(
                    'Senha definida',
                    'Sua senha foi alterada. Entre novamente com a nova senha.',
                    [{ text: 'OK', onPress: () => logout() }]
                );
            } else {
                // Logado: a sessão continua válida; apenas zera o flag e volta.
                updateUser({ must_change_password: false });
                Alert.alert('Senha alterada', 'Sua senha foi atualizada com sucesso.', [
                    { text: 'OK', onPress: () => navigation.goBack() },
                ]);
            }
        } catch (err) {
            Alert.alert('Erro', getApiErrorMessage(err as Error, 'Não foi possível alterar a senha.'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-brand-black" edges={['top', 'bottom']}>
            <ScrollView
                contentContainerClassName="flex-grow justify-center px-6 py-10"
                keyboardShouldPersistTaps="handled"
            >
                <View className="mb-8 items-center">
                    <Text className="text-3xl font-extrabold tracking-wide text-brand">
                        {mustChange ? 'Defina sua senha' : 'Alterar senha'}
                    </Text>
                    {mustChange ? (
                        <Text className="mt-2 text-center text-base text-neutral-300">
                            Por segurança, troque a senha no primeiro acesso.
                        </Text>
                    ) : null}
                </View>

                <View className="rounded-2xl bg-white p-5">
                    <Controller
                        control={control}
                        name="current_password"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                label="Senha atual"
                                placeholder="••••••••"
                                secureTextEntry
                                autoCapitalize="none"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.current_password?.message}
                                editable={!submitting}
                            />
                        )}
                    />
                    <Controller
                        control={control}
                        name="new_password"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                label="Nova senha"
                                placeholder="••••••••"
                                secureTextEntry
                                autoCapitalize="none"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.new_password?.message}
                                editable={!submitting}
                            />
                        )}
                    />
                    <Controller
                        control={control}
                        name="confirm"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                label="Confirmar nova senha"
                                placeholder="••••••••"
                                secureTextEntry
                                autoCapitalize="none"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.confirm?.message}
                                editable={!submitting}
                            />
                        )}
                    />

                    <PrimaryButton
                        title="Salvar nova senha"
                        loading={submitting}
                        onPress={handleSubmit(onSubmit)}
                    />

                    <Pressable
                        accessibilityRole="button"
                        onPress={() => (mustChange ? logout() : navigation.goBack())}
                        disabled={submitting}
                        className="mt-4 items-center py-2 active:opacity-70"
                    >
                        <Text className="text-sm font-semibold text-primary-600">
                            {mustChange ? 'Sair' : 'Cancelar'}
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}
