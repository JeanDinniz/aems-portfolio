import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { getApiErrorMessage } from '@/lib/api-error';
import { Loader2, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

const loginSchema = z.object({
    email: z.string().min(1, 'Email é obrigatório').email('Email inválido'),
    password: z.string().min(1, 'Senha é obrigatória'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
    const { login } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const submittedEmailRef = useRef('');

    const form = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: '',
            password: '',
        },
    });

    const onSubmit = async (data: LoginFormData) => {
        submittedEmailRef.current = data.email;
        setIsLoading(true);
        setError(null);
        try {
            await login(data);

            // useAuth já gerencia toda a navegação:
            // - must_change_password: true -> /change-password
            // - must_change_password: false -> não faz nada aqui, deixa o usuário navegar
            // Não fazemos navigate aqui para evitar conflito
        } catch (err) {
            setError(getApiErrorMessage(err as Error, 'Falha no login. Verifique suas credenciais.'));
            form.reset({ email: submittedEmailRef.current, password: '' });
            form.setFocus('password');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="w-full">
            {/* Header */}
            <div className="mb-8">
                <h2
                    className="text-2xl font-semibold text-white mb-1"
                    style={{ fontFamily: 'Josefin Sans, sans-serif' }}
                >
                    Bem-vindo de volta
                </h2>
                <p
                    className="text-zinc-400 text-sm"
                    style={{ fontFamily: 'Josefin Sans, sans-serif' }}
                >
                    Entre com suas credenciais para acessar o sistema.
                </p>
            </div>

            <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <div className="flex flex-col gap-5">
                    {/* Email field */}
                    <div className="flex flex-col gap-1.5">
                        <label
                            htmlFor="email"
                            className="text-sm font-medium text-zinc-300"
                            style={{ fontFamily: 'Josefin Sans, sans-serif' }}
                        >
                            Email
                        </label>
                        <div className="relative">
                            <Mail
                                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                                style={{ color: '#555555' }}
                            />
                            <input
                                id="email"
                                type="email"
                                placeholder="admin@aems.com.br"
                                autoComplete="email"
                                aria-invalid={!!form.formState.errors.email}
                                aria-describedby={form.formState.errors.email ? 'email-error' : undefined}
                                className={[
                                    'w-full h-11 pl-10 pr-4 rounded-lg text-sm text-white placeholder:text-zinc-600',
                                    'border transition-all duration-150 outline-none',
                                    'focus:ring-2 focus:ring-[#FCAF16] focus:border-[#FCAF16]',
                                    form.formState.errors.email
                                        ? 'border-red-500/70 focus:ring-red-500/50 focus:border-red-500'
                                        : 'border-[#333333] hover:border-[#444444]',
                                ].join(' ')}
                                style={{ backgroundColor: '#252525', fontFamily: 'Josefin Sans, sans-serif' }}
                                {...form.register('email')}
                            />
                        </div>
                        {form.formState.errors.email && (
                            <p id="email-error" className="flex items-center gap-1.5 text-xs text-red-400 mt-0.5">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                {form.formState.errors.email.message}
                            </p>
                        )}
                    </div>

                    {/* Password field */}
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                            <label
                                htmlFor="password"
                                className="text-sm font-medium text-zinc-300"
                                style={{ fontFamily: 'Josefin Sans, sans-serif' }}
                            >
                                Senha
                            </label>
                            <Link
                                to="/forgot-password"
                                className="text-xs font-medium transition-colors duration-150 hover:opacity-80"
                                style={{ color: '#FCAF16' }}
                            >
                                Esqueceu sua senha?
                            </Link>
                        </div>
                        <div className="relative">
                            <Lock
                                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                                style={{ color: '#555555' }}
                            />
                            <input
                                id="password"
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="current-password"
                                aria-invalid={!!form.formState.errors.password}
                                aria-describedby={form.formState.errors.password ? 'password-error' : undefined}
                                className={[
                                    'w-full h-11 pl-10 pr-11 rounded-lg text-sm text-white placeholder:text-zinc-600',
                                    'border transition-all duration-150 outline-none',
                                    'focus:ring-2 focus:ring-[#FCAF16] focus:border-[#FCAF16]',
                                    form.formState.errors.password
                                        ? 'border-red-500/70 focus:ring-red-500/50 focus:border-red-500'
                                        : 'border-[#333333] hover:border-[#444444]',
                                ].join(' ')}
                                style={{ backgroundColor: '#252525', fontFamily: 'Josefin Sans, sans-serif' }}
                                {...form.register('password')}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((prev) => !prev)}
                                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FCAF16] rounded"
                            >
                                {showPassword ? (
                                    <EyeOff className="w-4 h-4" />
                                ) : (
                                    <Eye className="w-4 h-4" />
                                )}
                            </button>
                        </div>
                        {form.formState.errors.password && (
                            <p id="password-error" className="flex items-center gap-1.5 text-xs text-red-400 mt-0.5">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                {form.formState.errors.password.message}
                            </p>
                        )}
                    </div>

                    {/* Global error */}
                    {error && (
                        <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
                            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                            <p className="text-sm text-red-400">{error}</p>
                        </div>
                    )}

                    {/* Submit button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full h-11 rounded-lg font-semibold tracking-wide text-sm text-zinc-900 transition-all duration-150 flex items-center justify-center gap-2 mt-1 disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FCAF16] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1A1A1A]"
                        style={{ backgroundColor: '#FCAF16', fontFamily: 'Josefin Sans, sans-serif' }}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Entrando...
                            </>
                        ) : (
                            'Entrar'
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
}
