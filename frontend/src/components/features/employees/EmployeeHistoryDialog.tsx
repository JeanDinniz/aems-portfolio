import { useState } from 'react';
import { Eye } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { MovementDetailDialog } from './MovementDetailDialog';
import { useEmployeeMovements } from '@/hooks/useEmployees';
import { MOVEMENT_TYPE_LABELS } from '@/constants/employees';
import type { Employee, EmployeeMovement } from '@/types/employee.types';

function formatDate(dateStr?: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR');
}

function buildDescription(movement: EmployeeMovement): string {
    const data = movement.movement_data as Record<string, unknown> | null;
    if (!data) return '—';
    switch (movement.type) {
        case 'transfer': {
            const origin = String(data.origin_store_name ?? data.origin_store_id ?? 'origem');
            const dest = String(data.destination_store_name ?? data.destination_store_id ?? 'destino');
            return `Transferido de ${origin} para ${dest}`;
        }
        case 'vacation': {
            const start = formatDate(String(data.start_date ?? ''));
            const ret = formatDate(String(data.return_date ?? ''));
            return `Ferias de ${start} a ${ret}`;
        }
        case 'absence': {
            const type = String(data.absence_type ?? '');
            const start = formatDate(String(data.start_date ?? ''));
            const ret = formatDate(String(data.return_date ?? ''));
            return `Afastamento (${type}) de ${start} a ${ret}`;
        }
        case 'fault': {
            const ft = String(data.fault_type ?? '');
            const days = data.days_count != null ? String(data.days_count) : '?';
            return `Falta ${ft} - ${days} dia(s)`;
        }
        case 'promotion': {
            const prev = String(data.previous_position ?? '');
            const next = String(data.new_position ?? '');
            return `Promovido de ${prev} para ${next}`;
        }
        case 'dismissal': {
            const dt = String(data.dismissal_type ?? '');
            return `Demissao (${dt})`;
        }
        default:
            return '—';
    }
}

function isWithin60Days(dateStr: string): boolean {
    const d = new Date(dateStr);
    const now = new Date();
    const msInDay = 1000 * 60 * 60 * 24;
    return (now.getTime() - d.getTime()) / msInDay <= 60;
}

interface EmployeeHistoryDialogProps {
    employee: Employee | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EmployeeHistoryDialog({ employee, open, onOpenChange }: EmployeeHistoryDialogProps) {
    const [selectedMovement, setSelectedMovement] = useState<EmployeeMovement | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);

    const { data, isLoading } = useEmployeeMovements(employee?.id ?? 0);
    const movements = data?.items ?? [];

    // Mini stats — computed from all available movements (page 1)
    const faultsLast60 = movements.filter(
        (m) => m.type === 'fault' && isWithin60Days(m.movement_date)
    ).length;

    const attestLast60 = movements.filter((m) => {
        if (m.type !== 'absence') return false;
        const data = m.movement_data as Record<string, unknown> | null;
        return data?.absence_type === 'atestado' && isWithin60Days(m.movement_date);
    }).length;

    const handleViewDetail = (movement: EmployeeMovement) => {
        setSelectedMovement(movement);
        setDetailOpen(true);
    };

    if (!employee) return null;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-3xl overflow-y-auto max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle>
                            Historico de Movimentacoes — {employee.name}
                        </DialogTitle>
                    </DialogHeader>

                    {/* Mini stats */}
                    <div className="grid grid-cols-2 gap-3">
                        <Card className="p-3">
                            <p className="text-xs text-muted-foreground">Faltas (ultimos 60 dias)</p>
                            <p className="text-xl font-bold mt-0.5">{faultsLast60}</p>
                        </Card>
                        <Card className="p-3">
                            <p className="text-xs text-muted-foreground">Atestados (ultimos 60 dias)</p>
                            <p className="text-xl font-bold mt-0.5">{attestLast60}</p>
                        </Card>
                    </div>

                    {/* Tabela de historico */}
                    {isLoading ? (
                        <div className="space-y-2">
                            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                        </div>
                    ) : (
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[56px]">Ver</TableHead>
                                        <TableHead>Data</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Descricao</TableHead>
                                        <TableHead>Anexo</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {movements.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                                Nenhuma movimentacao registrada
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        movements.map((mv) => (
                                            <TableRow key={mv.id}>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => handleViewDetail(mv)}
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                                <TableCell className="text-sm whitespace-nowrap">
                                                    {formatDate(mv.movement_date)}
                                                </TableCell>
                                                <TableCell className="text-sm font-medium">
                                                    {MOVEMENT_TYPE_LABELS[mv.type] ?? mv.type}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate">
                                                    {buildDescription(mv)}
                                                </TableCell>
                                                <TableCell>
                                                    {mv.attachment_url ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                                            Sim
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400">
                                                            Nao
                                                        </span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <MovementDetailDialog
                movement={selectedMovement}
                open={detailOpen}
                onOpenChange={setDetailOpen}
            />
        </>
    );
}
