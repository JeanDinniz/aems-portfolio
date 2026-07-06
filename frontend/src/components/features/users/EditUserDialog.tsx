import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { UserProfilesSection } from '@/components/features/access-profiles/UserProfilesSection';
import type { User, UserRole } from '@/types/user.types';

const editUserSchema = z.object({
    full_name: z.string().min(3, 'Nome deve ter no minimo 3 caracteres'),
    email: z.string().email('E-mail invalido').optional(),
    role: z.enum(['owner', 'user']),
});

type EditUserForm = z.infer<typeof editUserSchema>;

interface EditUserDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EditUserDialog({ user, open, onOpenChange }: EditUserDialogProps) {
    const { updateUser, isUpdating } = useUsers();

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors },
    } = useForm<EditUserForm>({
        resolver: zodResolver(editUserSchema),
    });

    useEffect(() => {
        if (open && user) {
            reset({
                full_name: user.full_name,
                email: user.email,
                role: user.role as EditUserForm['role'],
            });
        }
    }, [open, user, reset]);

    const selectedRole = watch('role');

    const onSubmit = (data: EditUserForm) => {
        updateUser({
            id: user.id,
            payload: {
                full_name: data.full_name,
                email: data.email,
                role: data.role as UserRole,
            },
        }, {
            onSuccess: () => {
                onOpenChange(false);
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Editar Usuario</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label htmlFor="eu-fullname" className="text-sm font-medium">Nome Completo</label>
                            <Input id="eu-fullname" {...register('full_name')} />
                            {errors.full_name && (
                                <p className="text-sm text-red-500">{errors.full_name.message}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="eu-email" className="text-sm font-medium">E-mail</label>
                            <Input id="eu-email" {...register('email')} />
                            {errors.email && (
                                <p className="text-sm text-red-500">{errors.email.message}</p>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="eu-role" className="text-sm font-medium">Cargo</label>
                        <Select
                            value={selectedRole}
                            onValueChange={(value) => setValue('role', value as EditUserForm['role'])}
                        >
                            <SelectTrigger id="eu-role">
                                <SelectValue placeholder="Selecione o cargo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="user">Usuario</SelectItem>
                                <SelectItem value="owner">Proprietario</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {selectedRole === 'user' && (
                        <div className="space-y-2">
                            <span className="text-sm font-medium">Perfis de Acesso</span>
                            <UserProfilesSection userId={user.id.toString()} />
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
                        <Button type="submit" disabled={isUpdating}>
                            {isUpdating ? 'Salvando...' : 'Salvar Alteracoes'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
