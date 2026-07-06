import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { RoleBadge } from './RoleBadge';
import { UserStatusBadge } from './UserStatusBadge';
import type { User } from '@/types/user.types';

interface UserDetailsDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function UserDetailsDialog({ user, open, onOpenChange }: UserDetailsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Detalhes do Usuário</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-center justify-between pb-4 border-b">
                        <div>
                            <h3 className="text-lg font-semibold">{user.full_name}</h3>
                            <p className="text-sm text-gray-500">{user.email}</p>
                        </div>
                        <UserStatusBadge isActive={user.is_active} />
                    </div>

                    <div className="space-y-3">
                        <div>
                            <span className="text-sm font-medium text-gray-500">Cargo</span>
                            <div className="mt-1">
                                <RoleBadge role={user.role} />
                            </div>
                        </div>

                        <div>
                            <span className="text-sm font-medium text-gray-500">Telefone</span>
                            <p>{user.phone || '-'}</p>
                        </div>

                        {user.store_name && (
                            <div>
                                <span className="text-sm font-medium text-gray-500">Loja Atribuída</span>
                                <p>{user.store_name}</p>
                            </div>
                        )}

                        <div>
                            <span className="text-sm font-medium text-gray-500">Último Login</span>
                            <p>
                                {user.last_login
                                    ? new Date(user.last_login).toLocaleString('pt-BR')
                                    : 'Nunca'}
                            </p>
                        </div>

                        <div>
                            <span className="text-sm font-medium text-gray-500">Data de Criação</span>
                            <p>{new Date(user.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>

                        {user.must_change_password && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                <p className="text-sm text-yellow-800">
                                    Este usuário precisa alterar a senha no próximo login.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
