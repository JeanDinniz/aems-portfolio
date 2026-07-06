import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MOVEMENT_TYPE_LABELS, ABSENCE_TYPES, FAULT_TYPES, DISMISSAL_TYPES } from '@/constants/employees';
import type { EmployeeMovement } from '@/types/employee.types';

function Field({ label, value }: { label: string; value?: string | number | null }) {
    return (
        <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-sm font-medium">{value || '—'}</p>
        </div>
    );
}

function formatDate(dateStr?: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR');
}

function getLabelFromList(list: { value: string; label: string }[], value?: string | null): string {
    if (!value) return '—';
    return list.find((i) => i.value === value)?.label ?? value;
}

interface MovementDetailDialogProps {
    movement: EmployeeMovement | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MovementDetailDialog({ movement, open, onOpenChange }: MovementDetailDialogProps) {
    if (!movement) return null;

    const data = movement.movement_data as Record<string, unknown> | null;

    const renderDetails = () => {
        if (!data) return null;
        switch (movement.type) {
            case 'transfer':
                return (
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Loja Origem" value={String(data.origin_store_name ?? data.origin_store_id ?? '—')} />
                        <Field label="Loja Destino" value={String(data.destination_store_name ?? data.destination_store_id ?? '—')} />
                        <Field label="Motivo" value={String(data.reason ?? '—')} />
                        <Field label="Responsavel" value={movement.created_by_name} />
                    </div>
                );
            case 'vacation':
                return (
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Previsao Vencimento" value={formatDate(String(data.forecast_date ?? ''))} />
                        <Field label="Data Inicio" value={formatDate(String(data.start_date ?? ''))} />
                        <Field label="Data Retorno" value={formatDate(String(data.return_date ?? ''))} />
                    </div>
                );
            case 'absence':
                return (
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Tipo de Afastamento" value={getLabelFromList(ABSENCE_TYPES, String(data.absence_type ?? ''))} />
                        <Field label="Data Inicio" value={formatDate(String(data.start_date ?? ''))} />
                        <Field label="Data Retorno" value={formatDate(String(data.return_date ?? ''))} />
                    </div>
                );
            case 'fault':
                return (
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Tipo de Falta" value={getLabelFromList(FAULT_TYPES, String(data.fault_type ?? ''))} />
                        <Field label="Data" value={formatDate(String(data.date ?? movement.movement_date))} />
                        <Field label="Quantidade de Dias" value={data.days_count != null ? String(data.days_count) : '—'} />
                    </div>
                );
            case 'promotion':
                return (
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Cargo Anterior" value={String(data.previous_position ?? '—')} />
                        <Field label="Novo Cargo" value={String(data.new_position ?? '—')} />
                        <Field label="Alteracao Salarial" value={String(data.salary_change ?? '—')} />
                        <Field label="Motivo" value={String(data.reason ?? '—')} />
                    </div>
                );
            case 'dismissal':
                return (
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Tipo de Demissao" value={getLabelFromList(DISMISSAL_TYPES, String(data.dismissal_type ?? ''))} />
                        <Field label="Data Desligamento" value={formatDate(String(data.dismissal_date ?? ''))} />
                        <Field label="Motivo" value={String(data.reason ?? data.dismissal_reason ?? '—')} />
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Detalhes da Movimentacao</DialogTitle>
                </DialogHeader>

                <div className="space-y-5">
                    {/* Dados basicos */}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Data da Movimentacao" value={formatDate(movement.movement_date)} />
                        <Field label="Tipo" value={MOVEMENT_TYPE_LABELS[movement.type] ?? movement.type} />
                    </div>

                    {/* Detalhes por tipo */}
                    {data && (
                        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-4">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Detalhes</p>
                            {renderDetails()}
                        </div>
                    )}

                    {/* Responsavel */}
                    {movement.created_by_name && (
                        <Field label="Registrado por" value={movement.created_by_name} />
                    )}

                    {/* Observacao */}
                    {movement.notes && (
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Observacao</p>
                            <p className="text-sm">{movement.notes}</p>
                        </div>
                    )}

                    {/* Anexo */}
                    {movement.attachment_url && (
                        <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Anexo</p>
                            <a
                                href={movement.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 dark:text-blue-400 underline"
                            >
                                Abrir anexo
                            </a>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
