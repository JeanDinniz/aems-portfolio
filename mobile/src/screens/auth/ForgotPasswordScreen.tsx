import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { TextField } from '@/components/common/TextField';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { authService } from '@/services/api/auth.service';
import type { AuthStackScreenProps } from '@/navigation/types';

const schema = z.object({
    email: z.string().min(1, 'Informe o e-mail').email('E-mail inválido'),
});
type FormValues = z.infer<typeof schema>;

export function ForgotPasswordScreen({ navigation }: AuthStackScreenProps<'ForgotPassword'>) {
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    const {
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

    const onSubmit = async (values: FormValues) => {
        Keyboard.dismiss();
        setSubmitting(true);
        try {
            await authService.forgotPassword(values.email);
        } catch {
            // Mensagem neutra — não revela existência do e-mail.
        } finally {
            setSubmitting(false);
            setDone(true);
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
                        Recuperar senha
                    </Text>
                </View>

                <View className="rounded-2xl bg-white p-5">
                    {done ? (
                        <Text className="mb-5 text-base text-neutral-700">
                            Se o e-mail informado estiver cadastrado, você receberá instruções para
                            redefinir sua senha.
                        </Text>
                    ) : (
                        <>
                            <Text className="mb-4 text-base text-neutral-600">
                                Informe seu e-mail e enviaremos um link para redefinir a senha.
                            </Text>
                            <Controller
                                control={control}
                                name="email"
                                render={({ field: { onChange, onBlur, value } }) => (
                                    <TextField
                                        label="E-mail"
                                        placeholder="seu@email.com"
                                        autoCapitalize="none"
                                        keyboardType="email-address"
                                        value={value}
                                        onChangeText={onChange}
                                        onBlur={onBlur}
                                        error={errors.email?.message}
                                        editable={!submitting}
                                    />
                                )}
                            />
                            <PrimaryButton
                                title="Enviar"
                                loading={submitting}
                                onPress={handleSubmit(onSubmit)}
                            />
                        </>
                    )}

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
