import { useEffect, useRef, useState } from 'react';
import {
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

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

/** Label do campo — DM Sans, sobre superfície escura. */
function FieldLabel({ children }: { children: string }) {
    return (
        <Text className="mb-1.5 font-sans-semibold text-sm text-dark-text-muted">{children}</Text>
    );
}

export function LoginScreen({ navigation }: AuthStackScreenProps<'Login'>) {
    const { login } = useAuth();
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    // Teclado aberto? Usado para encolher o cabeçalho e alinhar o formulário ao
    // topo — assim o card inteiro (senha + botão) cabe acima do teclado.
    const [keyboardOpen, setKeyboardOpen] = useState(false);
    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

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

    // Backup: ao focar a senha, garante que o campo + botão fiquem visíveis.
    const revealFields = () => {
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
    };

    return (
        <SafeAreaView className="flex-1 bg-brand-black" edges={['top', 'bottom']}>
            <KeyboardAvoidingView
                className="flex-1"
                // iOS empurra o conteúdo; no Android o windowSoftInputMode=adjustResize
                // já redimensiona a janela.
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={{
                        flexGrow: 1,
                        // Centralizado quando ocioso (visual); alinhado ao topo quando
                        // digitando, para caber acima do teclado.
                        justifyContent: keyboardOpen ? 'flex-start' : 'center',
                        paddingHorizontal: 24,
                        paddingVertical: keyboardOpen ? 16 : 40,
                    }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="none"
                    showsVerticalScrollIndicator={false}
                >
                    {/* Marca / logo — emblema Aems + wordmark; encolhe com o teclado */}
                    {keyboardOpen ? (
                        <View className="mb-6 flex-row items-center justify-center gap-2">
                            <Image
                                source={require('../../../assets/brand/logo-emblem.png')}
                                resizeMode="contain"
                                style={{ width: 34, height: 27 }}
                                accessibilityLabel="AEMS"
                            />
                            <Text className="font-display-bold text-2xl tracking-tight text-dark-text">
                                Wash <Text className="text-brand">Center</Text>
                            </Text>
                        </View>
                    ) : (
                        <View className="mb-9 items-center">
                            <Image
                                source={require('../../../assets/brand/logo-emblem.png')}
                                resizeMode="contain"
                                style={{ width: 100, height: 79 }}
                                accessibilityLabel="AEMS"
                            />
                            <Text className="mt-4 font-display-bold text-3xl tracking-tight text-dark-text">
                                Wash <Text className="text-brand">Center</Text>
                            </Text>
                            <View className="mt-3 h-[3px] w-12 rounded-full bg-brand" />
                            <Text className="mt-3 font-sans text-sm text-dark-text-muted">
                                Gestão de estética automotiva
                            </Text>
                        </View>
                    )}

                    {/* Card do formulário — superfície elevada com leve profundidade */}
                    <View
                        className="rounded-2xl border border-dark-border bg-dark-surface p-6"
                        style={{
                            shadowColor: '#000',
                            shadowOpacity: 0.35,
                            shadowRadius: 24,
                            shadowOffset: { width: 0, height: 12 },
                            elevation: 8,
                        }}
                    >
                        <Text className="mb-5 font-sans-bold text-xl text-dark-text">
                            Acesse sua conta
                        </Text>

                        {/* E-mail */}
                        <View className="mb-4">
                            <FieldLabel>E-mail</FieldLabel>
                            <Controller
                                control={control}
                                name="email"
                                render={({ field: { onChange, onBlur, value } }) => (
                                    <View
                                        className={`flex-row items-center rounded-xl border bg-dark-input px-4 ${
                                            errors.email ? 'border-error' : 'border-dark-border-strong'
                                        }`}
                                    >
                                        <Ionicons name="mail-outline" size={18} color="#999999" />
                                        <TextInput
                                            testID="login-email"
                                            placeholder="seu@email.com"
                                            placeholderTextColor="#555555"
                                            autoCapitalize="none"
                                            autoComplete="email"
                                            keyboardType="email-address"
                                            textContentType="emailAddress"
                                            value={value}
                                            onChangeText={onChange}
                                            onBlur={onBlur}
                                            editable={!submitting}
                                            className="ml-3 flex-1 py-3.5 font-sans text-base text-dark-text"
                                        />
                                    </View>
                                )}
                            />
                            {errors.email?.message ? (
                                <Text className="mt-1.5 font-sans text-sm text-error">
                                    {errors.email.message}
                                </Text>
                            ) : null}
                        </View>

                        {/* Senha (com olho inline) */}
                        <View className="mb-4">
                            <FieldLabel>Senha</FieldLabel>
                            <Controller
                                control={control}
                                name="password"
                                render={({ field: { onChange, onBlur, value } }) => (
                                    <View
                                        className={`flex-row items-center rounded-xl border bg-dark-input px-4 ${
                                            errors.password
                                                ? 'border-error'
                                                : 'border-dark-border-strong'
                                        }`}
                                    >
                                        <Ionicons
                                            name="lock-closed-outline"
                                            size={18}
                                            color="#999999"
                                        />
                                        <TextInput
                                            testID="login-password"
                                            placeholder="••••••••"
                                            placeholderTextColor="#555555"
                                            secureTextEntry={!showPassword}
                                            autoCapitalize="none"
                                            textContentType="password"
                                            value={value}
                                            onChangeText={onChange}
                                            onBlur={onBlur}
                                            onFocus={revealFields}
                                            editable={!submitting}
                                            onSubmitEditing={handleSubmit(onSubmit)}
                                            returnKeyType="go"
                                            className="ml-3 flex-1 py-3.5 font-sans text-base text-dark-text"
                                        />
                                        {/*
                                          CRÍTICO: o toque no olho NÃO pode fechar o teclado.
                                          - Pressable só troca o state (nunca chama Keyboard.dismiss/blur).
                                          - keyboardShouldPersistTaps="handled" no ScrollView evita o
                                            dismiss automático; o TextInput mantém o foco.
                                        */}
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={
                                                showPassword ? 'Ocultar senha' : 'Mostrar senha'
                                            }
                                            hitSlop={12}
                                            disabled={submitting}
                                            onPress={() => setShowPassword((prev) => !prev)}
                                            className="pl-2 active:opacity-60"
                                        >
                                            <Ionicons
                                                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                                size={20}
                                                color="#999999"
                                            />
                                        </Pressable>
                                    </View>
                                )}
                            />
                            {errors.password?.message ? (
                                <Text className="mt-1.5 font-sans text-sm text-error">
                                    {errors.password.message}
                                </Text>
                            ) : null}
                        </View>

                        {formError ? (
                            <View className="mb-4 flex-row items-center rounded-xl border border-error/40 bg-error/10 px-3 py-2.5">
                                <Ionicons name="alert-circle" size={18} color="#F87171" />
                                <Text className="ml-2 flex-1 font-sans-medium text-sm text-error-dark">
                                    {formError}
                                </Text>
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
                            className="mt-3 items-center py-2 active:opacity-60"
                        >
                            <Text className="font-sans-semibold text-sm text-brand">
                                Esqueci minha senha
                            </Text>
                        </Pressable>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}
