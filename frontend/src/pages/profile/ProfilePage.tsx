import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { User as UserIcon, Lock, Mail, Phone, Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '@/services/api/auth.service';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type { User as UserType } from '@/types/auth.types';

const profileSchema = z.object({
    name: z.string().min(3, 'Nome muito curto'),
    phone: z.string().optional(),
});

const passwordSchema = z
    .object({
        currentPassword: z.string().min(1, 'Senha atual obrigatória'),
        newPassword: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
        confirmPassword: z.string(),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: 'Senhas não conferem',
        path: ['confirmPassword'],
    });

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

const roleLabels: Record<string, string> = {
    owner: 'Proprietario',
    user: 'Usuario',
};

export function ProfilePage() {
    const { user, updateUser } = useAuthStore();
    const { toast } = useToast();

    const {
        register: registerProfile,
        handleSubmit: handleSubmitProfile,
        formState: { errors: profileErrors },
    } = useForm<ProfileForm>({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            name: user?.full_name || '',
            phone: user?.phone || '',
        },
    });

    const {
        register: registerPassword,
        handleSubmit: handleSubmitPassword,
        formState: { errors: passwordErrors },
        reset: resetPassword,
    } = useForm<PasswordForm>({
        resolver: zodResolver(passwordSchema),
    });

    const updateProfileMutation = useMutation({
        mutationFn: (data: ProfileForm) => authService.updateProfile(data) as Promise<Partial<UserType>>,
        onSuccess: (updatedUser: Partial<UserType>) => {
            updateUser(updatedUser);
            toast({
                title: 'Perfil atualizado',
                description: 'Suas informações foram salvas com sucesso.',
            });
        },
        onError: () => {
            toast({
                title: 'Não foi possível atualizar',
                description: 'Ocorreu um erro ao salvar as informações do perfil. Tente novamente.',
                variant: 'destructive',
            });
        },
    });

    const changePasswordMutation = useMutation({
        mutationFn: (data: PasswordForm) =>
            authService.changePassword(data.currentPassword, data.newPassword),
        onSuccess: () => {
            toast({
                title: 'Senha alterada',
                description: 'Sua senha foi atualizada com sucesso.',
            });
            resetPassword();
        },
        onError: (error: Error) => {
            toast({
                title: 'Não foi possível alterar a senha',
                description: getApiErrorMessage(error, 'Verifique a senha atual e tente novamente.'),
                variant: 'destructive',
            });
        },
    });

    if (!user) return null;

    return (
        <div className="p-6 max-w-4xl">
            {/* Header */}
            <div className="mb-8">
                <h1
                    className="text-3xl font-bold text-[#111111] dark:text-white"
                    style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                >
                    Meu Perfil
                </h1>
                <p className="text-[#666666] dark:text-zinc-400 mt-1">Gerencie suas informações pessoais</p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                {/* Card de Informações Básicas */}
                <div className="md:col-span-1 bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-6 space-y-4">
                    {/* Avatar e nome */}
                    <div className="text-center">
                        <div
                            className="mx-auto w-24 h-24 rounded-full flex items-center justify-center mb-4"
                            style={{ backgroundColor: 'rgba(252, 175, 22, 0.15)', border: '2px solid rgba(252, 175, 22, 0.3)' }}
                        >
                            <UserIcon className="h-12 w-12" style={{ color: '#F5A800' }} />
                        </div>
                        <h2
                            className="text-xl font-semibold text-[#111111] dark:text-white"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            {user.full_name}
                        </h2>
                        <p className="text-sm text-[#666666] dark:text-zinc-400 mt-0.5">{user.email}</p>
                    </div>

                    {/* Detalhes do perfil */}
                    <div className="space-y-3 pt-4 border-t border-[#D1D1D1] dark:border-[#333333]">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-[#666666] dark:text-zinc-400">Cargo:</span>
                            <span
                                className="text-xs font-semibold px-2.5 py-1 rounded-full border"
                                style={{ backgroundColor: 'rgba(252, 175, 22, 0.15)', color: '#F5A800', borderColor: 'rgba(252, 175, 22, 0.4)' }}
                            >
                                {roleLabels[user.role]}
                            </span>
                        </div>

                        {user.store_name && (
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-[#666666] dark:text-zinc-400">Loja:</span>
                                <span className="text-sm font-medium text-[#444444] dark:text-zinc-300">{user.store_name}</span>
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <span className="text-sm text-[#666666] dark:text-zinc-400">Status:</span>
                            {user.is_active ? (
                                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-green-900/40 text-green-400 border-green-700">
                                    Ativo
                                </span>
                            ) : (
                                <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border-[#D1D1D1] dark:border-[#333333]">
                                    Inativo
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tabs de Edição */}
                <div className="md:col-span-2 bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-6">
                    <Tabs defaultValue="profile">
                        <TabsList className="grid w-full grid-cols-2 bg-gray-100 dark:bg-zinc-800 rounded-lg p-1 mb-6">
                            <TabsTrigger
                                value="profile"
                                className="rounded-md text-[#666666] dark:text-zinc-400 data-[state=active]:text-[#1A1A1A] data-[state=active]:font-semibold transition-all"
                                style={{}}
                            >
                                Dados Pessoais
                            </TabsTrigger>
                            <TabsTrigger
                                value="password"
                                className="rounded-md text-[#666666] dark:text-zinc-400 data-[state=active]:text-[#1A1A1A] data-[state=active]:font-semibold transition-all"
                            >
                                Alterar Senha
                            </TabsTrigger>
                        </TabsList>

                        {/* Dados Pessoais */}
                        <TabsContent value="profile" className="space-y-5 mt-0">
                            <form
                                onSubmit={handleSubmitProfile((data) => updateProfileMutation.mutate(data))}
                                className="space-y-5"
                            >
                                <div className="space-y-1.5">
                                    <label htmlFor="pp-name" className="text-sm font-medium text-[#666666] dark:text-zinc-300">
                                        Nome Completo
                                    </label>
                                    <div className="relative">
                                        <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                                        <input
                                            id="pp-name"
                                            className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-[#111111] dark:text-white placeholder-[#999999] dark:placeholder-zinc-500 outline-none transition-colors bg-white dark:bg-[#1A1A1A] border border-[#D1D1D1] dark:border-[#333333] focus:border-[#F5A800] focus:ring-1 focus:ring-[#F5A800]"
                                            {...registerProfile('name')}
                                        />
                                    </div>
                                    {profileErrors.name && (
                                        <p className="text-sm text-red-400">{profileErrors.name.message}</p>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="pp-email" className="text-sm font-medium text-[#666666] dark:text-zinc-300">
                                        E-mail
                                    </label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#BBBBBB] dark:text-zinc-600 pointer-events-none" />
                                        <input
                                            id="pp-email"
                                            className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-[#999999] dark:text-zinc-500 outline-none bg-gray-100 dark:bg-zinc-900 border border-[#D1D1D1] dark:border-[#333333] cursor-not-allowed"
                                            value={user.email}
                                            disabled
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="pp-phone" className="text-sm font-medium text-[#666666] dark:text-zinc-300">
                                        Telefone
                                    </label>
                                    <div className="relative">
                                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                                        <input
                                            id="pp-phone"
                                            className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-[#111111] dark:text-white placeholder-[#999999] dark:placeholder-zinc-500 outline-none transition-colors bg-white dark:bg-[#1A1A1A] border border-[#D1D1D1] dark:border-[#333333] focus:border-[#F5A800] focus:ring-1 focus:ring-[#F5A800]"
                                            placeholder="(00) 00000-0000"
                                            {...registerProfile('phone')}
                                        />
                                    </div>
                                    {profileErrors.phone && (
                                        <p className="text-sm text-red-400">{profileErrors.phone.message}</p>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={updateProfileMutation.isPending}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-opacity disabled:opacity-60"
                                    style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                                >
                                    {updateProfileMutation.isPending && (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    )}
                                    Salvar Alterações
                                </button>
                            </form>
                        </TabsContent>

                        {/* Alterar Senha */}
                        <TabsContent value="password" className="space-y-5 mt-0">
                            <form
                                onSubmit={handleSubmitPassword((data) =>
                                    changePasswordMutation.mutate(data)
                                )}
                                className="space-y-5"
                            >
                                <div className="space-y-1.5">
                                    <label htmlFor="pp-current-pw" className="text-sm font-medium text-[#666666] dark:text-zinc-300">
                                        Senha Atual
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                                        <input
                                            id="pp-current-pw"
                                            type="password"
                                            className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-[#111111] dark:text-white placeholder-[#999999] dark:placeholder-zinc-500 outline-none transition-colors bg-white dark:bg-[#1A1A1A] border border-[#D1D1D1] dark:border-[#333333] focus:border-[#F5A800] focus:ring-1 focus:ring-[#F5A800]"
                                            {...registerPassword('currentPassword')}
                                        />
                                    </div>
                                    {passwordErrors.currentPassword && (
                                        <p className="text-sm text-red-400">{passwordErrors.currentPassword.message}</p>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="pp-new-pw" className="text-sm font-medium text-[#666666] dark:text-zinc-300">
                                        Nova Senha
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                                        <input
                                            id="pp-new-pw"
                                            type="password"
                                            className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-[#111111] dark:text-white placeholder-[#999999] dark:placeholder-zinc-500 outline-none transition-colors bg-white dark:bg-[#1A1A1A] border border-[#D1D1D1] dark:border-[#333333] focus:border-[#F5A800] focus:ring-1 focus:ring-[#F5A800]"
                                            {...registerPassword('newPassword')}
                                        />
                                    </div>
                                    {passwordErrors.newPassword && (
                                        <p className="text-sm text-red-400">{passwordErrors.newPassword.message}</p>
                                    )}
                                </div>

                                <div className="space-y-1.5">
                                    <label htmlFor="pp-confirm-pw" className="text-sm font-medium text-[#666666] dark:text-zinc-300">
                                        Confirmar Nova Senha
                                    </label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                                        <input
                                            id="pp-confirm-pw"
                                            type="password"
                                            className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm text-[#111111] dark:text-white placeholder-[#999999] dark:placeholder-zinc-500 outline-none transition-colors bg-white dark:bg-[#1A1A1A] border border-[#D1D1D1] dark:border-[#333333] focus:border-[#F5A800] focus:ring-1 focus:ring-[#F5A800]"
                                            {...registerPassword('confirmPassword')}
                                        />
                                    </div>
                                    {passwordErrors.confirmPassword && (
                                        <p className="text-sm text-red-400">{passwordErrors.confirmPassword.message}</p>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={changePasswordMutation.isPending}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-opacity disabled:opacity-60"
                                    style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                                >
                                    {changePasswordMutation.isPending && (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    )}
                                    Alterar Senha
                                </button>
                            </form>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
