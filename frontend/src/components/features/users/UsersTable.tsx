import { useState } from 'react';
import { MoreHorizontal, Edit, Key, Eye, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { UserStatusBadge } from './UserStatusBadge';
import { RoleBadge } from './RoleBadge';
import { EditUserDialog } from './EditUserDialog';
import { UserDetailsDialog } from './UserDetailsDialog';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { useUsers } from '@/hooks/useUsers';
import type { User } from '@/types/user.types';

interface UsersTableProps {
    users: User[];
    isLoading: boolean;
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
}

export function UsersTable({ users, isLoading, page, pageSize, total, onPageChange }: UsersTableProps) {
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
    const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);

    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canEdit = hasPermission('users', 'edit');
    const canDelete = hasPermission('users', 'delete');

    const { deleteUser, isDeletingUser, activateUser, deactivateUser } = useUsers();

    const handleEdit = (user: User) => {
        setSelectedUser(user);
        setEditDialogOpen(true);
    };

    const handleDetails = (user: User) => {
        setSelectedUser(user);
        setDetailsDialogOpen(true);
    };

    const handleResetPassword = (user: User) => {
        setSelectedUser(user);
        setResetPasswordDialogOpen(true);
    };

    if (isLoading) {
        return (
            <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                ))}
            </div>
        );
    }

    const totalPages = Math.ceil(total / pageSize);

    return (
        <div className="space-y-4">
            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Usuário</TableHead>
                            <TableHead>Cargo</TableHead>
                            <TableHead>Loja(s)</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Último Login</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-[#666666] dark:text-zinc-500 py-8">
                                    Nenhum usuário encontrado
                                </TableCell>
                            </TableRow>
                        ) : (
                            users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Avatar>
                                                <AvatarFallback className="bg-gray-200 dark:bg-zinc-700 text-[#444444] dark:text-zinc-200 text-xs font-semibold">
                                                    {user.full_name
                                                        .split(' ')
                                                        .slice(0, 2)
                                                        .map((n) => n[0])
                                                        .join('')
                                                        .toUpperCase()}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="font-medium">{user.full_name}</p>
                                                <p className="text-sm text-[#666666] dark:text-zinc-500">{user.email}</p>
                                            </div>
                                        </div>
                                    </TableCell>

                                    <TableCell>
                                        <RoleBadge role={user.role} />
                                    </TableCell>

                                    <TableCell>
                                        {user.role === 'owner' ? (
                                            <span className="text-sm text-[#444444] dark:text-zinc-300">Todas</span>
                                        ) : (
                                            <span className="text-sm text-[#444444] dark:text-zinc-300">{user.store_name || '-'}</span>
                                        )}
                                    </TableCell>

                                    <TableCell>
                                        <UserStatusBadge isActive={user.is_active} />
                                    </TableCell>

                                    <TableCell>
                                        {user.last_login ? (
                                            <span className="text-sm text-[#444444] dark:text-zinc-300">
                                                {new Date(user.last_login).toLocaleDateString('pt-BR')}
                                            </span>
                                        ) : (
                                            <span className="text-sm text-[#999999] dark:text-zinc-500">Nunca</span>
                                        )}
                                    </TableCell>

                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="text-[#F5A800]">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleDetails(user)}>
                                                    <Eye className="h-4 w-4 mr-2" />
                                                    Ver Detalhes
                                                </DropdownMenuItem>
                                                {canEdit && (
                                                    <DropdownMenuItem onClick={() => handleEdit(user)}>
                                                        <Edit className="h-4 w-4 mr-2" />
                                                        Editar
                                                    </DropdownMenuItem>
                                                )}
                                                {canEdit && (
                                                    <DropdownMenuItem onClick={() => handleResetPassword(user)}>
                                                        <Key className="h-4 w-4 mr-2" />
                                                        Resetar Senha
                                                    </DropdownMenuItem>
                                                )}
                                                {canEdit && (
                                                    user.is_active ? (
                                                        <DropdownMenuItem onClick={() => deactivateUser(user.id)} className="ring-1 ring-[#F5A800] ring-inset rounded-sm">
                                                            <Eye className="h-4 w-4 mr-2" />
                                                            Desativar
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem onClick={() => activateUser(user.id)}>
                                                            <Eye className="h-4 w-4 mr-2 text-green-600" />
                                                            <span className="text-green-600">Ativar</span>
                                                        </DropdownMenuItem>
                                                    )
                                                )}
                                                {canDelete && (
                                                    <DropdownMenuItem
                                                        onClick={() => setUserToDelete(user)}
                                                        className="text-red-600 focus:text-red-600"
                                                    >
                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                        Excluir
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Paginação */}
            {total > 0 && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-[#444444] dark:text-zinc-300">
                        Mostrando {(page - 1) * pageSize + 1} a{' '}
                        {Math.min(page * pageSize, total)} de {total} usuários
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page === 1}
                            onClick={() => onPageChange(page - 1)}
                        >
                            Anterior
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page === totalPages}
                            onClick={() => onPageChange(page + 1)}
                        >
                            Próximo
                        </Button>
                    </div>
                </div>
            )}

            {/* Dialogs */}
            {selectedUser && (
                <>
                    <EditUserDialog
                        user={selectedUser}
                        open={editDialogOpen}
                        onOpenChange={setEditDialogOpen}
                    />
                    <UserDetailsDialog
                        user={selectedUser}
                        open={detailsDialogOpen}
                        onOpenChange={setDetailsDialogOpen}
                    />
                    <ResetPasswordDialog
                        user={selectedUser}
                        open={resetPasswordDialogOpen}
                        onOpenChange={setResetPasswordDialogOpen}
                    />
                </>
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog
                open={!!userToDelete}
                onOpenChange={(open) => { if (!open) setUserToDelete(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
                        <AlertDialogDescription>
                            O usuário{' '}
                            <span className="font-semibold">{userToDelete?.full_name}</span>{' '}
                            será excluído permanentemente. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeletingUser}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => userToDelete && deleteUser(userToDelete.id, {
                                onSuccess: () => setUserToDelete(null),
                            })}
                            disabled={isDeletingUser}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isDeletingUser ? 'Excluindo...' : 'Excluir'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
