import { useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import { useCanEdit } from '@/hooks/useMyPermissions';
import { employeesService } from '@/services/api/employees.service';
import { useCreateDelivery, useEpiCatalog } from '@/hooks/useEpi';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

export function DeliveryTab() {
    const canEdit = useCanEdit('epi');

    const { data: empData } = useQuery({
        queryKey: ['epi-delivery-employees'],
        queryFn: () => employeesService.list({ hr_status: 'active' }, 1, 500),
    });
    const employees = empData?.employees ?? [];
    const { data: catalog } = useEpiCatalog(1, true);
    const createDelivery = useCreateDelivery();

    const [employeeId, setEmployeeId] = useState('');
    const [epiId, setEpiId] = useState('');
    const [obs, setObs] = useState('');
    const [sigEmpty, setSigEmpty] = useState(true);
    const sigRef = useRef<SignaturePadHandle>(null);

    const epis = catalog?.items ?? [];
    const selectedName = useMemo(
        () => employees.find((e) => String(e.id) === employeeId)?.name ?? '[funcionário]',
        [employees, employeeId],
    );

    if (!canEdit) {
        return (
            <p className="py-10 text-center text-sm text-muted-foreground">
                Você não tem permissão para registrar entregas.
            </p>
        );
    }

    const confirm = () => {
        const assinatura = sigRef.current?.getDataUrl();
        if (!assinatura) return;
        createDelivery.mutate(
            { employee_id: Number(employeeId), epi_id: Number(epiId), assinatura_base64: assinatura, observacao: obs || null },
            {
                onSuccess: () => {
                    setEmployeeId('');
                    setEpiId('');
                    setObs('');
                    setSigEmpty(true);
                    sigRef.current?.clear();
                },
            },
        );
    };

    const canConfirm = !!employeeId && !!epiId && !sigEmpty && !createDelivery.isPending;

    return (
        <div className="mx-auto max-w-xl space-y-5 pt-4">
            <div className="space-y-2">
                <Label>Funcionário</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger>
                        <SelectValue placeholder="Selecione o funcionário" />
                    </SelectTrigger>
                    <SelectContent>
                        {employees.map((e) => (
                            <SelectItem key={e.id} value={String(e.id)}>
                                {e.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>EPI entregue</Label>
                <Select value={epiId} onValueChange={setEpiId}>
                    <SelectTrigger>
                        <SelectValue placeholder="Selecione o EPI" />
                    </SelectTrigger>
                    <SelectContent>
                        {epis.map((e) => (
                            <SelectItem key={e.id} value={String(e.id)}>
                                {e.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>Observação (opcional)</Label>
                <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
                Eu, <strong>{selectedName}</strong>, declaro ter recebido os equipamentos descritos
                em perfeitas condições de uso.
            </div>

            <div className="space-y-1">
                <Label>Assinatura</Label>
                <SignaturePad ref={sigRef} onEmptyChange={setSigEmpty} />
            </div>

            <Button className="w-full" onClick={confirm} disabled={!canConfirm}>
                {createDelivery.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar Entrega
            </Button>
        </div>
    );
}
