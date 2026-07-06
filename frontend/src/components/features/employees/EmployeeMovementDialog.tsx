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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateMovement } from '@/hooks/useEmployees';
import { useStores } from '@/hooks/useStores';
import {
    MOVEMENT_TYPE_LABELS,
    ABSENCE_TYPES,
    FAULT_TYPES,
    DISMISSAL_TYPES,
    EMPLOYEE_POSITIONS,
} from '@/constants/employees';
import type { Employee, MovementType } from '@/types/employee.types';

function formatEmployeeId(id: number): string {
    return 'F' + id.toString().padStart(3, '0');
}

const movementTypes: { value: MovementType; label: string }[] = Object.entries(MOVEMENT_TYPE_LABELS).map(
    ([value, label]) => ({ value: value as MovementType, label })
);

const schema = z.object({
    type: z.enum(['transfer', 'vacation', 'absence', 'fault', 'promotion', 'dismissal']),
    movement_date: z.string().min(1, 'Data obrigatoria'),
    // Transfer
    destination_store_id: z.string().optional(),
    transfer_reason: z.string().optional(),
    // Vacation
    forecast_date: z.string().optional(),
    vacation_start: z.string().optional(),
    vacation_return: z.string().optional(),
    // Absence
    absence_type: z.string().optional(),
    absence_start: z.string().optional(),
    absence_return: z.string().optional(),
    // Fault
    fault_type: z.string().optional(),
    fault_date: z.string().optional(),
    fault_days: z.string().optional(),
    // Promotion
    new_position: z.string().optional(),
    salary_change: z.string().optional(),
    promotion_reason: z.string().optional(),
    // Dismissal
    dismissal_type: z.string().optional(),
    dismissal_reason: z.string().optional(),
    dismissal_date: z.string().optional(),
    // Shared
    notes: z.string().optional(),
    attachment_url: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

function buildMovementData(data: FormData): Record<string, unknown> {
    switch (data.type) {
        case 'transfer':
            return {
                destination_store_id: data.destination_store_id ? Number(data.destination_store_id) : undefined,
                reason: data.transfer_reason,
            };
        case 'vacation':
            return {
                forecast_date: data.forecast_date,
                start_date: data.vacation_start,
                return_date: data.vacation_return,
            };
        case 'absence':
            return {
                absence_type: data.absence_type,
                start_date: data.absence_start,
                return_date: data.absence_return,
            };
        case 'fault':
            return {
                fault_type: data.fault_type,
                date: data.fault_date,
                days_count: data.fault_days ? Number(data.fault_days) : undefined,
            };
        case 'promotion':
            return {
                previous_position: undefined,
                new_position: data.new_position,
                salary_change: data.salary_change,
                reason: data.promotion_reason,
            };
        case 'dismissal':
            return {
                dismissal_type: data.dismissal_type,
                reason: data.dismissal_reason,
                dismissal_date: data.dismissal_date,
            };
        default:
            return {};
    }
}

interface EmployeeMovementDialogProps {
    employee: Employee | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EmployeeMovementDialog({ employee, open, onOpenChange }: EmployeeMovementDialogProps) {
    const createMovement = useCreateMovement();
    const { allStores } = useStores();

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { movement_date: new Date().toISOString().slice(0, 10) },
    });

    const movementType = watch('type');

    useEffect(() => {
        if (open) {
            reset({ movement_date: new Date().toISOString().slice(0, 10) });
        }
    }, [open, reset]);

    const onSubmit = (data: FormData) => {
        if (!employee) return;
        const movementData = buildMovementData(data);
        if (data.type === 'promotion') {
            movementData.previous_position = employee.position ?? '';
        }
        createMovement.mutate(
            {
                employeeId: employee.id,
                data: {
                    type: data.type,
                    movement_date: data.movement_date,
                    movement_data: movementData,
                    notes: data.notes || null,
                    attachment_url: data.attachment_url || null,
                },
            },
            { onSuccess: () => { reset(); onOpenChange(false); } }
        );
    };

    if (!employee) return null;

    const hasAttachment = ['absence', 'fault', 'dismissal'].includes(movementType);

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
            <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>Registrar Movimentacao</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                    {/* Dados do funcionario (readonly) — usar <p> pois nao sao controles de formulario */}
                    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/40 p-3">
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">ID Funcionario</p>
                            <p className="text-sm font-mono font-medium">{formatEmployeeId(employee.id)}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nome</p>
                            <p className="text-sm font-medium">{employee.name}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cargo</p>
                            <p className="text-sm">{employee.position || '—'}</p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Loja Atual</p>
                            <p className="text-sm">{employee.store_name || 'N/A'}</p>
                        </div>
                    </div>

                    {/* Tipo + Data */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <label htmlFor="mov-type" className="text-sm font-medium">
                                Tipo de Movimentacao <span className="text-red-500">*</span>
                            </label>
                            <Select
                                value={movementType || ''}
                                onValueChange={(v) => setValue('type', v as MovementType)}
                            >
                                <SelectTrigger id="mov-type">
                                    <SelectValue placeholder="Selecione o tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    {movementTypes.map((t) => (
                                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {errors.type && <p className="text-sm text-red-500">{errors.type.message}</p>}
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="mov-date" className="text-sm font-medium">
                                Data da Movimentacao <span className="text-red-500">*</span>
                            </label>
                            <Input id="mov-date" type="date" {...register('movement_date')} />
                            {errors.movement_date && <p className="text-sm text-red-500">{errors.movement_date.message}</p>}
                        </div>
                    </div>

                    {/* Transferencia */}
                    {movementType === 'transfer' && (
                        <div className="space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transferencia</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label htmlFor="mov-dest-store" className="text-sm font-medium">Loja Destino</label>
                                    <Select
                                        value={watch('destination_store_id') || ''}
                                        onValueChange={(v) => setValue('destination_store_id', v)}
                                    >
                                        <SelectTrigger id="mov-dest-store">
                                            <SelectValue placeholder="Selecione a loja" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {allStores.filter((s) => s.id !== employee.store_id).map((store) => (
                                                <SelectItem key={store.id} value={store.id.toString()}>
                                                    {store.code} - {store.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-transfer-reason" className="text-sm font-medium">Motivo</label>
                                    <Input id="mov-transfer-reason" {...register('transfer_reason')} placeholder="Motivo da transferencia" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Ferias */}
                    {movementType === 'vacation' && (
                        <div className="space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ferias</p>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-2">
                                    <label htmlFor="mov-forecast" className="text-sm font-medium">Previsao Vencimento</label>
                                    <Input id="mov-forecast" type="date" {...register('forecast_date')} />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-vac-start" className="text-sm font-medium">Data Inicio</label>
                                    <Input id="mov-vac-start" type="date" {...register('vacation_start')} />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-vac-return" className="text-sm font-medium">Data Retorno</label>
                                    <Input id="mov-vac-return" type="date" {...register('vacation_return')} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Afastamento */}
                    {movementType === 'absence' && (
                        <div className="space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Afastamento</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label htmlFor="mov-absence-type" className="text-sm font-medium">Tipo de Afastamento</label>
                                    <Select
                                        value={watch('absence_type') || ''}
                                        onValueChange={(v) => setValue('absence_type', v)}
                                    >
                                        <SelectTrigger id="mov-absence-type">
                                            <SelectValue placeholder="Selecione o tipo" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ABSENCE_TYPES.map((t) => (
                                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2 col-span-1" />
                                <div className="space-y-2">
                                    <label htmlFor="mov-abs-start" className="text-sm font-medium">Data Inicio</label>
                                    <Input id="mov-abs-start" type="date" {...register('absence_start')} />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-abs-return" className="text-sm font-medium">Data Retorno</label>
                                    <Input id="mov-abs-return" type="date" {...register('absence_return')} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="mov-abs-notes" className="text-sm font-medium">Observacao</label>
                                <Textarea id="mov-abs-notes" {...register('notes')} placeholder="Descreva o motivo do afastamento..." rows={2} />
                            </div>
                        </div>
                    )}

                    {/* Falta */}
                    {movementType === 'fault' && (
                        <div className="space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Falta</p>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-2">
                                    <label htmlFor="mov-fault-type" className="text-sm font-medium">Tipo de Falta</label>
                                    <Select
                                        value={watch('fault_type') || ''}
                                        onValueChange={(v) => setValue('fault_type', v)}
                                    >
                                        <SelectTrigger id="mov-fault-type">
                                            <SelectValue placeholder="Selecione" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FAULT_TYPES.map((t) => (
                                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-fault-date" className="text-sm font-medium">Data</label>
                                    <Input id="mov-fault-date" type="date" {...register('fault_date')} />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-fault-days" className="text-sm font-medium">Qtd Dias</label>
                                    <Input id="mov-fault-days" type="number" min="1" {...register('fault_days')} placeholder="1" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="mov-fault-notes" className="text-sm font-medium">Observacao</label>
                                <Textarea id="mov-fault-notes" {...register('notes')} placeholder="Observacoes..." rows={2} />
                            </div>
                        </div>
                    )}

                    {/* Promocao */}
                    {movementType === 'promotion' && (
                        <div className="space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Promocao</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label htmlFor="mov-prev-pos" className="text-sm font-medium">Cargo Anterior</label>
                                    <Input id="mov-prev-pos" value={employee.position || 'Nao definido'} disabled className="bg-muted/50" />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-new-pos" className="text-sm font-medium">Novo Cargo</label>
                                    <Select
                                        value={watch('new_position') || ''}
                                        onValueChange={(v) => setValue('new_position', v)}
                                    >
                                        <SelectTrigger id="mov-new-pos">
                                            <SelectValue placeholder="Selecione o cargo" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {EMPLOYEE_POSITIONS.map((pos) => (
                                                <SelectItem key={pos.value} value={pos.value}>{pos.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-salary" className="text-sm font-medium">Alteracao Salarial</label>
                                    <Input id="mov-salary" {...register('salary_change')} placeholder="Ex: R$ 500,00 de aumento" />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-promo-reason" className="text-sm font-medium">Motivo</label>
                                    <Input id="mov-promo-reason" {...register('promotion_reason')} placeholder="Motivo da promocao" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Demissao */}
                    {movementType === 'dismissal' && (
                        <div className="space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Demissao</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label htmlFor="mov-dismissal-type" className="text-sm font-medium">Tipo de Demissao</label>
                                    <Select
                                        value={watch('dismissal_type') || ''}
                                        onValueChange={(v) => setValue('dismissal_type', v)}
                                    >
                                        <SelectTrigger id="mov-dismissal-type">
                                            <SelectValue placeholder="Selecione" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {DISMISSAL_TYPES.map((t) => (
                                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="mov-dismissal-date" className="text-sm font-medium">Data Desligamento</label>
                                    <Input id="mov-dismissal-date" type="date" {...register('dismissal_date')} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="mov-dismissal-reason" className="text-sm font-medium">Motivo</label>
                                <Textarea id="mov-dismissal-reason" {...register('dismissal_reason')} placeholder="Descreva o motivo..." rows={2} />
                            </div>
                        </div>
                    )}

                    {/* Anexo */}
                    {hasAttachment && (
                        <div className="space-y-2">
                            <label htmlFor="mov-attachment" className="text-sm font-medium">URL do Anexo</label>
                            <Input id="mov-attachment" {...register('attachment_url')} placeholder="https://..." />
                            <p className="text-xs text-muted-foreground">Informe a URL do documento anexado.</p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={createMovement.isPending || !movementType}
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            {createMovement.isPending ? 'Registrando...' : 'Registrar Movimentacao'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
