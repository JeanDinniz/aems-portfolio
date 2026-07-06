import { DEPARTMENTS } from '@/constants/service-orders';
import type { UseFormReturn, FieldValues, Path, PathValue } from 'react-hook-form';

interface OrderSummaryProps<T extends FieldValues = FieldValues> {
    form: UseFormReturn<T>;
}

export function OrderSummary<T extends FieldValues = FieldValues>({ form }: OrderSummaryProps<T>) {
    const plate = form.watch('plate' as Path<T>) as PathValue<T, Path<T>>;
    const vehicleModel = form.watch('vehicle_model' as Path<T>) as PathValue<T, Path<T>>;
    const department = form.watch('department' as Path<T>) as string;
    const selectedServices = form.watch('selected_services' as Path<T>) as number[] | undefined;

    return (
        <div className="bg-aems-neutral-50 border border-aems-neutral-150 rounded-xl p-4 space-y-2 text-sm">
            <p className="font-semibold text-aems-neutral-600 text-xs uppercase tracking-wide mb-3">Resumo da O.S.</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-aems-neutral-600">
                <span className="text-aems-neutral-400">Placa</span>
                <span className="font-mono font-bold tracking-widest">{(plate as string) || '—'}</span>
                <span className="text-aems-neutral-400">Modelo</span>
                <span>{(vehicleModel as string) || '—'}</span>
                <span className="text-aems-neutral-400">Departamento</span>
                <span>{DEPARTMENTS.find(d => d.value === department)?.label || '—'}</span>
                <span className="text-aems-neutral-400">Serviços</span>
                <span>{selectedServices?.length ?? 0} selecionado(s)</span>
            </div>
        </div>
    );
}
