import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { TextField } from '@/components/common/TextField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { useAuth } from '@/hooks/useAuth';
import { getApiErrorStatus } from '@/lib/api-error';
import type { AuthStackScreenProps } from '@/navigation/types';

const loginSchema = z.object({
    email: z.string().min(1, 'Informe o e-mail').email('E-mail inválido'),
    password: z.string().min(1, 'Informe a senha'),
});

type LoginForm = z.infer<typeof loginSchema>;

/** Deriva a mensagem de erro de login a partir do erro da API (AUTH-01). */
function loginErrorMessage(error: Error): string {
    const status = getApiErrorStatus(error);
    const detail = (
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? ''
    ).toLowerCase();

    if (detail.includes('tentativa') || detail.includes('bloque') || status === 429) {
        return 'Muitas tentativas. Tente novamente em alguns minutos.';
    }
    if (status === 403 || detail.includes('perfil') || detail.includes('acesso')) {
        return 'Seu acesso não está configurado. Procure o administrador.';
    }
    if (status === 401) {
        return 'E-mail ou senha inválidos.';
    }
    return 'Não foi possível entrar. Verifique sua conexão e tente novamente.';
}

export function LoginScreen({ navigation }: AuthStackScreenProps<'Login'>) {
    const { login } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<LoginForm>({
        resolver: zodResolver(loginSchema),
        defaultValues: { email: '', password: '' },
    });

    const onSubmit = async (values: LoginForm) => {
        Keyboard.dismiss();
        setFormError(null);
        setSubmitting(true);
        try {
            await login(values);
            // Sucesso: o RootNavigator reage ao estado (vai p/ AppStack ou ChangePassword).
        } catch (err) {
            setFormError(loginErrorMessage(err as Error));
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
                <View className="mb-10 items-center">
                    <Text className="text-4xl font-extrabold tracking-wide text-brand">
                        AEMS
                    </Text>
                    <Text className="mt-2 text-base text-neutral-300">
                        Entre para continuar
                    </Text>
                </View>

                <View className="rounded-2xl bg-white p-5">
                    <Controller
                        control={control}
                        name="email"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                testID="login-email"
                                label="E-mail"
                                placeholder="seu@email.com"
                                autoCapitalize="none"
                                autoComplete="email"
                                keyboardType="email-address"
                                textContentType="emailAddress"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.email?.message}
                                editable={!submitting}
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="password"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                testID="login-password"
                                label="Senha"
                                placeholder="••••••••"
                                secureTextEntry
                                autoCapitalize="none"
                                textContentType="password"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.password?.message}
                                editable={!submitting}
                                onSubmitEditing={handleSubmit(onSubmit)}
                                returnKeyType="go"
                            />
                        )}
                    />

                    {formError ? (
                        <View className="mb-4 rounded-lg bg-error-light px-3 py-2">
                            <Text className="text-sm font-medium text-error">{formError}</Text>
                        </View>
                    ) : null}

                    <PrimaryButton
                        title="Entrar"
                        loading={submitting}
                        onPress={handleSubmit(onSubmit)}
                    />

                    <Pressable
                        accessibilityRole="button"
                        onPress={() => navigation.navigate('ForgotPassword')}
                        disabled={submitting}
                        className="mt-4 items-center py-2 active:opacity-70"
                    >
                        <Text className="text-sm font-semibold text-primary-600">
                            Esqueci minha senha
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}
