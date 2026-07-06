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
import type { AuthStackScreenProps } from '@/navigation/types';

const schema = z
    .object({
        token: z.string().min(1, 'Token inválido'),
        password: z
            .string()
            .min(8, 'Mínimo de 8 caracteres')
            .regex(/[A-Za-z]/, 'Inclua ao menos uma letra')
            .regex(/[0-9]/, 'Inclua ao menos um número'),
        confirm: z.string().min(1, 'Confirme a senha'),
    })
    .refine((d) => d.password === d.confirm, {
        message: 'As senhas não coincidem',
        path: ['confirm'],
    });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordScreen({ route, navigation }: AuthStackScreenProps<'ResetPassword'>) {
    const tokenFromLink = route.params?.token ?? '';
    const [submitting, setSubmitting] = useState(false);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { token: tokenFromLink, password: '', confirm: '' },
    });

    const onSubmit = async (values: FormValues) => {
        Keyboard.dismiss();
        setSubmitting(true);
        try {
            await authService.resetPassword(values.token, values.password);
            Alert.alert('Senha redefinida', 'Faça login com sua nova senha.', [
                { text: 'OK', onPress: () => navigation.navigate('Login') },
            ]);
        } catch (err) {
            Alert.alert('Erro', getApiErrorMessage(err as Error, 'Token inválido ou expirado.'));
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
                        Nova senha
                    </Text>
                </View>

                <View className="rounded-2xl bg-white p-5">
                    {!tokenFromLink ? (
                        <Controller
                            control={control}
                            name="token"
                            render={({ field: { onChange, onBlur, value } }) => (
                                <TextField
                                    label="Código / token"
                                    placeholder="Cole o token recebido por e-mail"
                                    autoCapitalize="none"
                                    value={value}
                                    onChangeText={onChange}
                                    onBlur={onBlur}
                                    error={errors.token?.message}
                                    editable={!submitting}
                                />
                            )}
                        />
                    ) : null}

                    <Controller
                        control={control}
                        name="password"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                label="Nova senha"
                                placeholder="••••••••"
                                secureTextEntry
                                autoCapitalize="none"
                                value={value}
                                onChangeText={onChange}
                                onBlur={onBlur}
                                error={errors.password?.message}
                                editable={!submitting}
                            />
                        )}
                    />

                    <Controller
                        control={control}
                        name="confirm"
                        render={({ field: { onChange, onBlur, value } }) => (
                            <TextField
                                label="Confirmar senha"
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
                        title="Redefinir senha"
                        loading={submitting}
                        onPress={handleSubmit(onSubmit)}
                    />

                    <Pressable
                        accessibilityRole="button"
                        onPress={() => navigation.navigate('Login')}
                        className="mt-4 items-center py-2 active:opacity-70"
                    >
                        <Text className="text-sm font-semibold text-primary-600">
                            Voltar ao login
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}
