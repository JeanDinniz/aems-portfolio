import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { authService } from '@/services/api/auth.service';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';

const passwordRequirements = [
    { label: 'Mínimo 8 caracteres', test: (v: string) => v.length >= 8 },
    { label: 'Pelo menos uma letra maiúscula', test: (v: string) => /[A-Z]/.test(v) },
    { label: 'Pelo menos uma letra minúscula', test: (v: string) => /[a-z]/.test(v) },
    { label: 'Pelo menos um número', test: (v: string) => /\d/.test(v) },
    {
        label: 'Pelo menos um caractere especial',
        test: (v: string) => /[!@#$%^&*()_+\-=[\]{}';:"\\|,.<>/?`~]/.test(v),
    },
];

const resetPasswordSchema = z
    .object({
        newPassword: z
            .string()
            .min(8, 'Mínimo 8 caracteres')
            .regex(/[A-Z]/, 'Pelo menos uma letra maiúscula')
            .regex(/[a-z]/, 'Pelo menos uma letra minúscula')
            .regex(/\d/, 'Pelo menos um número')
            .regex(/[!@#$%^&*()_+\-=[\]{}';:"\\|,.<>/?`~]/, 'Pelo menos um caractere especial'),
        confirmPassword: z.string().min(1, 'Confirmação de senha é obrigatória'),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: 'Senhas não conferem',
        path: ['confirmPassword'],
    });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

const FONT = 'Barlow, Barlow Semi Condensed, sans-serif';

export function ResetPasswordPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';

    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [newPasswordFocused, setNewPasswordFocused] = useState(false);

    const {
        register,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm<ResetPasswordForm>({
        resolver: zodResolver(resetPasswordSchema),
        defaultValues: { newPassword: '', confirmPassword: '' },
    });

    const newPasswordValue = watch('newPassword') ?? '';

    const mutation = useMutation({
        mutationFn: (data: ResetPasswordForm) => authService.resetPassword(token, data.newPassword),
        onSuccess: () => {
            toast({
                title: 'Senha redefinida',
                description: 'Faça login com sua nova senha.',
            });
            navigate('/login');
        },
        onError: (err) => {
            toast({
                title: 'Não foi possível redefinir',
                description: getApiErrorMessage(
                    err as Error,
                    'O link pode ter expirado ou já ter sido usado. Solicite um novo.',
                ),
                variant: 'destructive',
            });
        },
    });

    const onSubmit = (data: ResetPasswordForm) => mutation.mutate(data);

    // Sem token na URL: link inválido/incompleto
    if (!token) {
        return (
            <div
                className="flex items-center justify-center min-h-screen p-4"
                style={{ backgroundColor: '#1A1A1A' }}
            >
                <div className="w-full max-w-md">
                    <div className="flex flex-col items-center mb-8">
                        <img
                            src="/brand/logo-white.png"
                            alt="AEMS"
                            className="h-12 w-auto mb-4 object-contain"
                        />
                        <div className="w-16 h-0.5 bg-[#F5A800]" />
                    </div>
                    <div
                        className="rounded-2xl border border-[#333333] p-8 shadow-2xl text-center"
                        style={{ backgroundColor: '#252525' }}
                    >
                        <h1 className="text-xl font-bold text-white mb-2" style={{ fontFamily: FONT }}>
                            Link inválido
                        </h1>
                        <p className="text-sm text-zinc-400 mb-6">
                            Este link de redefinição está incompleto ou expirou. Solicite um novo.
                        </p>
                        <Link
                            to="/forgot-password"
                            className="w-full h-11 rounded-lg font-semibold text-sm flex items-center justify-center hover:brightness-110 transition-all duration-150"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A', fontFamily: FONT }}
                        >
                            Solicitar novo link
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex items-center justify-center min-h-screen p-4"
            style={{ backgroundColor: '#1A1A1A' }}
        >
            <div className="w-full max-w-md">
                {/* Logo + accent line */}
                <div className="flex flex-col items-center mb-8">
                    <img
                        src="/brand/logo-white.png"
                        alt="AEMS"
                        className="h-12 w-auto mb-4 object-contain"
                    />
                    <div className="w-16 h-0.5 bg-[#F5A800]" />
                </div>

                {/* Card */}
                <div
                    className="rounded-2xl border border-[#333333] p-8 shadow-2xl"
                    style={{ backgroundColor: '#252525' }}
                >
                    <div className="mb-6">
                        <h1 className="text-xl font-bold text-white mb-1" style={{ fontFamily: FONT }}>
                            Redefinir Senha
                        </h1>
                        <p className="text-sm text-zinc-400">Escolha uma nova senha para sua conta.</p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                        {/* Nova Senha */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="newPassword"
                                className="text-sm font-medium text-zinc-300"
                                style={{ fontFamily: FONT }}
                            >
                                Nova Senha
                            </label>
                            <div className="relative">
                                <input
                                    id="newPassword"
                                    type={showNew ? 'text' : 'password'}
                                    {...register('newPassword')}
                                    onFocus={() => setNewPasswordFocused(true)}
                                    onBlur={() => setNewPasswordFocused(false)}
                                    className={[
                                        'w-full h-11 px-3 pr-10 rounded-lg text-sm text-white',
                                        'border hover:border-[#444444]',
                                        'focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] focus:outline-none',
                                        'transition-colors duration-150',
                                        errors.newPassword ? 'border-red-500/70' : 'border-[#333333]',
                                    ].join(' ')}
                                    style={{ backgroundColor: '#1A1A1A', fontFamily: FONT }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNew((v) => !v)}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-200"
                                    tabIndex={-1}
                                >
                                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {(newPasswordFocused || newPasswordValue.length > 0) && (
                                <ul className="space-y-1 pt-1">
                                    {passwordRequirements.map((req) => {
                                        const met = req.test(newPasswordValue);
                                        const hasError = !!errors.newPassword && !met;
                                        return (
                                            <li
                                                key={req.label}
                                                className="flex items-center gap-1.5 text-xs"
                                            >
                                                {met ? (
                                                    <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                                                ) : (
                                                    <X
                                                        className={`h-3.5 w-3.5 shrink-0 ${hasError ? 'text-red-400' : 'text-zinc-500'}`}
                                                    />
                                                )}
                                                <span
                                                    className={
                                                        met
                                                            ? 'text-green-400'
                                                            : hasError
                                                              ? 'text-red-400'
                                                              : 'text-zinc-500'
                                                    }
                                                >
                                                    {req.label}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Confirmar Senha */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="confirmPassword"
                                className="text-sm font-medium text-zinc-300"
                                style={{ fontFamily: FONT }}
                            >
                                Confirmar Nova Senha
                            </label>
                            <div className="relative">
                                <input
                                    id="confirmPassword"
                                    type={showConfirm ? 'text' : 'password'}
                                    {...register('confirmPassword')}
                                    className={[
                                        'w-full h-11 px-3 pr-10 rounded-lg text-sm text-white',
                                        'border hover:border-[#444444]',
                                        'focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] focus:outline-none',
                                        'transition-colors duration-150',
                                        errors.confirmPassword ? 'border-red-500/70' : 'border-[#333333]',
                                    ].join(' ')}
                                    style={{ backgroundColor: '#1A1A1A', fontFamily: FONT }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm((v) => !v)}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-200"
                                    tabIndex={-1}
                                >
                                    {showConfirm ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                            {errors.confirmPassword && (
                                <p className="text-sm text-red-400">{errors.confirmPassword.message}</p>
                            )}
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={mutation.isPending}
                            className="w-full h-11 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 transition-all duration-150 mt-2"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A', fontFamily: FONT }}
                        >
                            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                            Redefinir Senha
                        </button>

                        {/* Back to login */}
                        <Link
                            to="/login"
                            className="w-full h-11 rounded-lg text-sm font-medium flex items-center justify-center gap-2 text-zinc-400 hover:text-zinc-200 border border-[#333333] hover:border-[#444444] transition-colors duration-150"
                            style={{ fontFamily: FONT }}
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Voltar para Login
                        </Link>
                    </form>
                </div>
            </div>
        </div>
    );
}
