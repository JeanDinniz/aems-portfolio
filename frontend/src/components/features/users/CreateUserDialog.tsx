import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUsers } from '@/hooks/useUsers';
import { useToast } from '@/hooks/use-toast';
import type { User, UserRole } from '@/types/user.types';

const createUserSchema = z.object({
    full_name: z.string().min(3, 'Nome deve ter no minimo 3 caracteres'),
    email: z.string().email('E-mail invalido'),
    role: z.enum(['owner', 'user']),
    password: z
        .string()
        .min(8, 'Mínimo 8 caracteres')
        .regex(/[A-Z]/, 'Pelo menos uma letra maiúscula')
        .regex(/[a-z]/, 'Pelo menos uma letra minúscula')
        .regex(/\d/, 'Pelo menos um número')
        .regex(/[!@#$%^&*()_+\-=[\]{}';:"\\|,.<>/?`~]/, 'Pelo menos um caractere especial'),
});

const passwordRequirements = [
    { label: 'Mínimo 8 caracteres', test: (v: string) => v.length >= 8 },
    { label: 'Pelo menos uma letra maiúscula', test: (v: string) => /[A-Z]/.test(v) },
    { label: 'Pelo menos uma letra minúscula', test: (v: string) => /[a-z]/.test(v) },
    { label: 'Pelo menos um número', test: (v: string) => /\d/.test(v) },
    { label: 'Pelo menos um caractere especial', test: (v: string) => /[!@#$%^&*()_+\-=[\]{}';:"\\|,.<>/?`~]/.test(v) },
];

type CreateUserForm = z.infer<typeof createUserSchema>;

interface CreateUserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialValues?: {
        full_name?: string;
        email?: string;
        store_id?: number;
    };
    onCreated?: (user: User) => void;
}

export function CreateUserDialog({ open, onOpenChange, initialValues, onCreated }: CreateUserDialogProps) {
    const { createUser, isCreating } = useUsers();
    const { toast } = useToast();
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
        reset,
    } = useForm<CreateUserForm>({
        resolver: zodResolver(createUserSchema),
    });

    useEffect(() => {
        if (open && initialValues) {
            if (initialValues.full_name) setValue('full_name', initialValues.full_name);
            if (initialValues.email) setValue('email', initialValues.email);
        }
        if (!open) {
            reset();
        }
    }, [open, initialValues, setValue, reset]);

    const selectedRole = watch('role');
    const passwordValue = watch('password') ?? '';

    const onSubmit = (data: CreateUserForm) => {
        createUser({
            full_name: data.full_name,
            email: data.email,
            role: data.role as UserRole,
            password: data.password,
            ...(initialValues?.store_id ? { store_id: initialValues.store_id } : {}),
        }, {
            onSuccess: (newUser) => {
                reset();
                onOpenChange(false);
                onCreated?.(newUser);
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Novo Usuario</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit, () => {
                        toast({
                            title: 'Formulário inválido',
                            description: 'Corrija os campos destacados antes de continuar.',
                            variant: 'destructive',
                        });
                    })} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label htmlFor="cu-fullname" className="text-sm font-medium">Nome Completo</label>
                            <Input
                                id="cu-fullname"
                                {...register('full_name')}
                                placeholder="Ex: Joao da Silva"
                            />
                            {errors.full_name && (
                                <p className="text-sm text-red-500">{errors.full_name.message}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="cu-email" className="text-sm font-medium">E-mail</label>
                            <Input
                                id="cu-email"
                                type="email"
                                {...register('email')}
                                placeholder="email@exemplo.com"
                            />
                            {errors.email && (
                                <p className="text-sm text-red-500">{errors.email.message}</p>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label htmlFor="cu-role" className="text-sm font-medium">Cargo</label>
                            <Select onValueChange={(value) => setValue('role', value as CreateUserForm['role'])}>
                                <SelectTrigger id="cu-role">
                                    <SelectValue placeholder="Selecione o cargo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="user">Usuario</SelectItem>
                                    <SelectItem value="owner">Proprietario</SelectItem>
                                </SelectContent>
                            </Select>
                            {errors.role && (
                                <p className="text-sm text-red-500">{errors.role.message}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="cu-password" className="text-sm font-medium">Senha Temporaria</label>
                            <div className="relative">
                                <Input
                                    id="cu-password"
                                    type={showPassword ? 'text' : 'password'}
                                    {...register('password')}
                                    placeholder="Mínimo 8 caracteres"
                                    className="pr-10"
                                    onFocus={() => setPasswordFocused(true)}
                                    onBlur={() => setPasswordFocused(false)}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(v => !v)}
                                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {(passwordFocused || passwordValue.length > 0) && (
                                <ul className="space-y-1 pt-1">
                                    {passwordRequirements.map((req) => {
                                        const met = req.test(passwordValue);
                                        const hasError = !!errors.password && !met;
                                        return (
                                            <li key={req.label} className="flex items-center gap-1.5 text-xs">
                                                {met
                                                    ? <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                                    : <X className={`h-3.5 w-3.5 shrink-0 ${hasError ? 'text-red-500' : 'text-muted-foreground'}`} />
                                                }
                                                <span className={met ? 'text-green-600 dark:text-green-400' : hasError ? 'text-red-500' : 'text-muted-foreground'}>
                                                    {req.label}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>

                    {selectedRole === 'user' && (
                        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                            <p className="text-sm text-amber-800 dark:text-amber-200">
                                Este usuario tera acesso baseado em perfis. Vincule os perfis apos criar o usuario via "Editar".
                            </p>
                        </div>
                    )}

                    {selectedRole === 'owner' && (
                        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                            <p className="text-sm text-blue-800 dark:text-blue-200">
                                Proprietarios tem acesso total a todas as lojas do sistema.
                            </p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isCreating}>
                            {isCreating ? 'Criando...' : 'Criar Usuario'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
