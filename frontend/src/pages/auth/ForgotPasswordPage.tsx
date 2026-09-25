import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Mail, Loader2 } from 'lucide-react';
import { authService } from '@/services/api/auth.service';
import { useToast } from '@/hooks/use-toast';

const forgotPasswordSchema = z.object({
    email: z.string().email('E-mail inválido'),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordPage() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [emailSent, setEmailSent] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<ForgotPasswordForm>({
        resolver: zodResolver(forgotPasswordSchema),
    });

    const mutation = useMutation({
        mutationFn: (data: ForgotPasswordForm) => authService.forgotPassword(data.email),
        onSuccess: () => {
            setEmailSent(true);
            toast({
                title: 'E-mail enviado',
                description: 'Verifique sua caixa de entrada para redefinir sua senha.',
            });
        },
        onError: () => {
            toast({
                title: 'Não foi possível enviar',
                description: 'Não foi possível enviar o e-mail de recuperação. Tente novamente.',
                variant: 'destructive',
            });
        },
    });

    const onSubmit = (data: ForgotPasswordForm) => {
        mutation.mutate(data);
    };

    if (emailSent) {
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
                        className="rounded-2xl border border-[#333333] p-8 shadow-2xl text-center"
                        style={{ backgroundColor: '#252525' }}
                    >
                        {/* Amber icon circle */}
                        <div
                            className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-5"
                            style={{ backgroundColor: 'rgba(252, 175, 22, 0.15)' }}
                        >
                            <Mail className="h-8 w-8" style={{ color: '#F5A800' }} />
                        </div>

                        <h1
                            className="text-xl font-bold text-white mb-2"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            E-mail Enviado!
                        </h1>
                        <p className="text-sm text-zinc-400 mb-6">
                            Enviamos um link para redefinir sua senha. Verifique sua caixa de entrada.
                        </p>

                        <button
                            onClick={() => navigate('/login')}
                            className="w-full h-11 rounded-lg font-semibold text-sm hover:brightness-110 transition-all duration-150"
                            style={{
                                backgroundColor: '#F5A800',
                                color: '#1A1A1A',
                                fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                            }}
                        >
                            Voltar para Login
                        </button>
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
                    {/* Header */}
                    <div className="mb-6">
                        <h1
                            className="text-xl font-bold text-white mb-1"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Esqueceu a Senha?
                        </h1>
                        <p className="text-sm text-zinc-400">
                            Digite seu e-mail e enviaremos instruções para redefinir sua senha.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        {/* Email field */}
                        <div className="space-y-1.5">
                            <label
                                htmlFor="email"
                                className="text-sm font-medium text-zinc-300"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                E-mail
                            </label>
                            <input
                                id="email"
                                type="email"
                                placeholder="seu@email.com"
                                {...register('email')}
                                className={[
                                    'w-full h-11 px-3 rounded-lg text-sm text-white placeholder:text-zinc-500',
                                    'border hover:border-[#444444]',
                                    'focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] focus:outline-none',
                                    'transition-colors duration-150',
                                    errors.email ? 'border-red-500/70' : 'border-[#333333]',
                                ].join(' ')}
                                style={{
                                    backgroundColor: '#1A1A1A',
                                    fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                                }}
                            />
                            {errors.email && (
                                <p className="text-sm text-red-400">{errors.email.message}</p>
                            )}
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={mutation.isPending}
                            className="w-full h-11 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 transition-all duration-150"
                            style={{
                                backgroundColor: '#F5A800',
                                color: '#1A1A1A',
                                fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                            }}
                        >
                            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                            Enviar Link de Recuperação
                        </button>

                        {/* Back to login */}
                        <Link
                            to="/login"
                            className="w-full h-11 rounded-lg text-sm font-medium flex items-center justify-center gap-2 text-zinc-400 hover:text-zinc-200 border border-[#333333] hover:border-[#444444] transition-colors duration-150"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
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
