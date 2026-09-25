import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '@/services/api/auth.service';
import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import { logger } from '@/lib/logger';

const passwordRequirements = [
    { label: 'Mínimo 8 caracteres', test: (v: string) => v.length >= 8 },
    { label: 'Pelo menos uma letra maiúscula', test: (v: string) => /[A-Z]/.test(v) },
    { label: 'Pelo menos uma letra minúscula', test: (v: string) => /[a-z]/.test(v) },
    { label: 'Pelo menos um número', test: (v: string) => /\d/.test(v) },
    { label: 'Pelo menos um caractere especial', test: (v: string) => /[!@#$%^&*()_+\-=[\]{}';:"\\|,.<>/?`~]/.test(v) },
];

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
    newPassword: z
        .string()
        .min(8, 'Mínimo 8 caracteres')
        .regex(/[A-Z]/, 'Pelo menos uma letra maiúscula')
        .regex(/[a-z]/, 'Pelo menos uma letra minúscula')
        .regex(/\d/, 'Pelo menos um número')
        .regex(/[!@#$%^&*()_+\-=[\]{}';:"\\|,.<>/?`~]/, 'Pelo menos um caractere especial'),
    confirmPassword: z.string().min(1, 'Confirmação de senha é obrigatória'),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Senhas não conferem",
    path: ["confirmPassword"],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

export default function ChangePasswordPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user, isLoading: authLoading } = useAuthStore();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newPasswordFocused, setNewPasswordFocused] = useState(false);
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const form = useForm<ChangePasswordFormData>({
        resolver: zodResolver(changePasswordSchema),
        defaultValues: {
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
        },
    });

    const newPasswordValue = form.watch('newPassword') ?? '';

    if (authLoading) {
        return (
            <div
                className="flex h-screen w-full items-center justify-center"
                style={{ backgroundColor: '#1A1A1A' }}
            >
                <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#F5A800' }} />
            </div>
        );
    }

    if (!user) {
        setTimeout(() => navigate('/login'), 0);
        return null;
    }

    // Se usuário existe mas NÃO precisa trocar senha, manda para ordens de serviço
    if (!user.must_change_password) {
        setTimeout(() => navigate('/service-orders'), 0);
        return null;
    }

    const onSubmit = async (data: ChangePasswordFormData) => {
        setIsSubmitting(true);
        try {
            await authService.changePassword(data.currentPassword, data.newPassword);

            toast({
                title: 'Senha alterada com sucesso',
                description: 'Faça login novamente com sua nova senha.',
            });

            // Logout forçado após troca de senha para limpar estado "must_change_password"
            await authService.logout();
            navigate('/login');

        } catch (err) {
            logger.error('Erro ao alterar senha:', err);
            toast({
                title: 'Erro ao alterar senha',
                description: getApiErrorMessage(err as Error, 'Ocorreu um erro ao tentar alterar a senha.'),
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="flex min-h-screen items-center justify-center p-4"
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
                    {/* Header */}
                    <div className="mb-6">
                        <h1
                            className="text-xl font-bold text-white mb-1"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Troca de Senha Obrigatória
                        </h1>
                        <p className="text-sm text-zinc-400">
                            Por segurança, você deve alterar sua senha antes de continuar.
                        </p>
                    </div>

                    <form onSubmit={form.handleSubmit(onSubmit, () => {
                            toast({
                                title: 'Formulário inválido',
                                description: 'Corrija os campos destacados antes de continuar.',
                                variant: 'destructive',
                            });
                        })} className="space-y-5">
                        {/* Senha Atual */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="currentPassword"
                                className="text-sm font-medium text-zinc-300"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Senha Atual
                            </label>
                            <div className="relative">
                                <input
                                    id="currentPassword"
                                    type={showCurrent ? 'text' : 'password'}
                                    {...form.register('currentPassword')}
                                    className={[
                                        'w-full h-11 px-3 pr-10 rounded-lg text-sm text-white',
                                        'border hover:border-[#444444]',
                                        'focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] focus:outline-none',
                                        'transition-colors duration-150',
                                        form.formState.errors.currentPassword
                                            ? 'border-red-500/70'
                                            : 'border-[#333333]',
                                    ].join(' ')}
                                    style={{
                                        backgroundColor: '#1A1A1A',
                                        fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCurrent(v => !v)}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-200"
                                    tabIndex={-1}
                                >
                                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {form.formState.errors.currentPassword && (
                                <p className="text-sm text-red-400">
                                    {form.formState.errors.currentPassword.message}
                                </p>
                            )}
                        </div>

                        {/* Nova Senha */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="newPassword"
                                className="text-sm font-medium text-zinc-300"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Nova Senha
                            </label>
                            <div className="relative">
                                <input
                                    id="newPassword"
                                    type={showNew ? 'text' : 'password'}
                                    {...form.register('newPassword')}
                                    onFocus={() => setNewPasswordFocused(true)}
                                    onBlur={() => setNewPasswordFocused(false)}
                                    className={[
                                        'w-full h-11 px-3 pr-10 rounded-lg text-sm text-white',
                                        'border hover:border-[#444444]',
                                        'focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] focus:outline-none',
                                        'transition-colors duration-150',
                                        form.formState.errors.newPassword
                                            ? 'border-red-500/70'
                                            : 'border-[#333333]',
                                    ].join(' ')}
                                    style={{
                                        backgroundColor: '#1A1A1A',
                                        fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowNew(v => !v)}
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
                                        const hasError = !!form.formState.errors.newPassword && !met;
                                        return (
                                            <li key={req.label} className="flex items-center gap-1.5 text-xs">
                                                {met
                                                    ? <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                                                    : <X className={`h-3.5 w-3.5 shrink-0 ${hasError ? 'text-red-400' : 'text-zinc-500'}`} />
                                                }
                                                <span className={met ? 'text-green-400' : hasError ? 'text-red-400' : 'text-zinc-500'}>
                                                    {req.label}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        {/* Confirmar Nova Senha */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="confirmPassword"
                                className="text-sm font-medium text-zinc-300"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Confirmar Nova Senha
                            </label>
                            <div className="relative">
                                <input
                                    id="confirmPassword"
                                    type={showConfirm ? 'text' : 'password'}
                                    {...form.register('confirmPassword')}
                                    className={[
                                        'w-full h-11 px-3 pr-10 rounded-lg text-sm text-white',
                                        'border hover:border-[#444444]',
                                        'focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] focus:outline-none',
                                        'transition-colors duration-150',
                                        form.formState.errors.confirmPassword
                                            ? 'border-red-500/70'
                                            : 'border-[#333333]',
                                    ].join(' ')}
                                    style={{
                                        backgroundColor: '#1A1A1A',
                                        fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirm(v => !v)}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-200"
                                    tabIndex={-1}
                                >
                                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {form.formState.errors.confirmPassword && (
                                <p className="text-sm text-red-400">
                                    {form.formState.errors.confirmPassword.message}
                                </p>
                            )}
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full h-11 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 transition-all duration-150 mt-2"
                            style={{
                                backgroundColor: '#F5A800',
                                color: '#1A1A1A',
                                fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                            }}
                        >
                            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            Alterar Senha
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
