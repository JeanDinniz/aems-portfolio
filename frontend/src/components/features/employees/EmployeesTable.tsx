import { useState } from 'react';
import { FileText, ArrowRightLeft, Clock, Trash2 } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useEmployees } from '@/hooks/useEmployees';
import type { Employee } from '@/types/employee.types';

const statusConfig: Record<string, { label: string; className: string }> = {
    active: { label: 'Ativo', className: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border border-green-300 dark:border-green-700/50' },
    away: { label: 'Afastado', className: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700/50' },
    dismissed: { label: 'Demitido', className: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border border-red-300 dark:border-red-700/50' },
};

function getEmployeeStatus(employee: Employee): 'active' | 'away' | 'dismissed' {
    if (employee.hr_status) return employee.hr_status;
    return employee.is_active ? 'active' : 'dismissed';
}

function formatEmployeeId(id: number): string {
    return 'F' + id.toString().padStart(3, '0');
}

interface Props {
    employees: Employee[];
    isLoading: boolean;
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onFicha: (employee: Employee) => void;
    onMovimentacao: (employee: Employee) => void;
    onHistorico: (employee: Employee) => void;
}

export function EmployeesTable({
    employees,
    isLoading,
    page,
    pageSize,
    total,
    onPageChange,
    onFicha,
    onMovimentacao,
    onHistorico,
}: Props) {
    const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);

    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canEdit = hasPermission('employees', 'edit');
    const canDelete = hasPermission('employees', 'delete');

    const { deleteEmployee, isDeletingEmployee } = useEmployees();

    if (isLoading) {
        return (
            <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
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
                            <TableHead className="w-[120px]">Acoes</TableHead>
                            <TableHead className="w-[90px]">ID</TableHead>
                            <TableHead>Nome Completo</TableHead>
                            <TableHead>Cargo</TableHead>
                            <TableHead>Loja</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {employees.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-[#666666] dark:text-zinc-500 py-8">
                                    Nenhum funcionario encontrado
                                </TableCell>
                            </TableRow>
                        ) : (
                            employees.map((emp) => {
                                const status = getEmployeeStatus(emp);
                                const statusCfg = statusConfig[status] ?? statusConfig.active;
                                return (
                                    <TableRow key={emp.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Ficha"
                                                    aria-label={`Ficha de ${emp.name}`}
                                                    onClick={() => onFicha(emp)}
                                                    className="h-8 w-8 text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white"
                                                >
                                                    <FileText className="h-4 w-4" />
                                                </Button>
                                                {canEdit && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        title="Movimentacoes"
                                                        aria-label={`Movimentações de ${emp.name}`}
                                                        onClick={() => onMovimentacao(emp)}
                                                        className="h-8 w-8 text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white"
                                                    >
                                                        <ArrowRightLeft className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Historico"
                                                    aria-label={`Histórico de ${emp.name}`}
                                                    onClick={() => onHistorico(emp)}
                                                    className="h-8 w-8 text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white"
                                                >
                                                    <Clock className="h-4 w-4" />
                                                </Button>
                                                {canDelete && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        title="Excluir"
                                                        aria-label={`Excluir ${emp.name}`}
                                                        onClick={() => setEmployeeToDelete(emp)}
                                                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm font-mono text-[#666666] dark:text-zinc-400">
                                            {formatEmployeeId(emp.id)}
                                        </TableCell>
                                        <TableCell className="font-medium">{[emp.name, emp.last_name].filter(Boolean).join(' ')}</TableCell>
                                        <TableCell className="text-sm text-[#444444] dark:text-zinc-300">
                                            {emp.position || '—'}
                                        </TableCell>
                                        <TableCell className="text-sm text-[#444444] dark:text-zinc-300">
                                            {emp.store_name || 'N/A'}
                                        </TableCell>
                                        <TableCell>
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusCfg.className}`}>
                                                {statusCfg.label}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-[#444444] dark:text-zinc-300">
                        Mostrando {(page - 1) * pageSize + 1} a {Math.min(page * pageSize, total)} de {total} funcionarios
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
                            Anterior
                        </Button>
                        <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
                            Proximo
                        </Button>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog
                open={!!employeeToDelete}
                onOpenChange={(open) => { if (!open) setEmployeeToDelete(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir funcionario?</AlertDialogTitle>
                        <AlertDialogDescription>
                            O funcionario{' '}
                            <span className="font-semibold">{employeeToDelete?.name}</span>{' '}
                            sera excluido permanentemente. Esta acao nao pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeletingEmployee}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => employeeToDelete && deleteEmployee(employeeToDelete.id, {
                                onSuccess: () => setEmployeeToDelete(null),
                            })}
                            disabled={isDeletingEmployee}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isDeletingEmployee ? 'Excluindo...' : 'Excluir'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
