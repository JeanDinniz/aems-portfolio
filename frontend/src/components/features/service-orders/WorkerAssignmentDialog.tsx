import { useEffect, useState } from 'react';
import { employeesService } from '@/services/api/employees.service';
import { useQuery } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';

interface WorkerAssignmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storeId: number;
    onConfirm: (workerIds: number[], primaryWorkerId: number) => void;
    isSubmitting?: boolean;
    isGalpon?: boolean;
}

export function WorkerAssignmentDialog({
    open,
    onOpenChange,
    storeId,
    onConfirm,
    isSubmitting = false,
    isGalpon = false,
}: WorkerAssignmentDialogProps) {
    const [selectedWorkers, setSelectedWorkers] = useState<number[]>([]);
    const [primaryWorker, setPrimaryWorker] = useState<string | null>(null);

    // Fetch employees: galpão uses for_galpon query, normal uses store filter
    const { data: employees, isLoading } = useQuery({
        queryKey: isGalpon ? ['employees', 'galpon'] : ['employees', 'by-store', storeId],
        queryFn: () =>
            isGalpon
                ? employeesService.listForGalpon()
                : employeesService.listByStore(storeId),
        enabled: open && (isGalpon ? true : !!storeId),
    });

    // Reset state when opening
    useEffect(() => {
        if (open) {
            setSelectedWorkers([]);
            setPrimaryWorker(null);
        }
    }, [open]);

    const handleToggleWorker = (workerId: number) => {
        setSelectedWorkers(prev => {
            if (prev.includes(workerId)) {
                const newSelection = prev.filter(id => id !== workerId);
                if (primaryWorker === workerId.toString()) {
                    setPrimaryWorker(null);
                }
                return newSelection;
            } else {
                return [...prev, workerId];
            }
        });
    };

    const handleConfirm = () => {
        if (selectedWorkers.length === 0 || !primaryWorker) return;
        onConfirm(selectedWorkers, parseInt(primaryWorker));
    };

    const isValid = selectedWorkers.length > 0 && !!primaryWorker;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Atribuir Funcionários</DialogTitle>
                    <DialogDescription>
                        Selecione quem irá trabalhar nesta Ordem de Serviço e defina o responsável principal.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {isLoading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : !employees || employees.length === 0 ? (
                        <p className="text-center text-muted-foreground py-4">
                            {isGalpon
                                ? 'Nenhum funcionário ativo para o galpão encontrado.'
                                : 'Nenhum funcionário ativo encontrado nesta loja.'}
                        </p>
                    ) : (
                        <ScrollArea className="h-[300px] pr-4">
                            <div className="space-y-4">
                                <RadioGroup value={primaryWorker || ''} onValueChange={setPrimaryWorker}>
                                    {employees.map((employee) => {
                                        const isSelected = selectedWorkers.includes(employee.id);
                                        return (
                                            <div key={employee.id} className={`flex items-start space-x-3 p-2 rounded-md transition-colors ${isSelected ? 'bg-muted/50' : ''}`}>
                                                <Checkbox
                                                    id={`worker-${employee.id}`}
                                                    checked={isSelected}
                                                    onCheckedChange={() => handleToggleWorker(employee.id)}
                                                    className="mt-1"
                                                />
                                                <div className="flex-1 space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <Label
                                                            htmlFor={`worker-${employee.id}`}
                                                            className="font-medium cursor-pointer"
                                                        >
                                                            {employee.name}
                                                        </Label>
                                                        {isSelected && (
                                                            <div className="flex items-center space-x-1 ml-auto">
                                                                <RadioGroupItem value={employee.id.toString()} id={`primary-${employee.id}`} />
                                                                <Label htmlFor={`primary-${employee.id}`} className="text-xs text-muted-foreground cursor-pointer">
                                                                    Principal
                                                                </Label>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {employee.position && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {employee.position}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </RadioGroup>
                            </div>
                        </ScrollArea>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancelar
                    </Button>
                    <Button onClick={handleConfirm} disabled={!isValid || isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar e Iniciar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
