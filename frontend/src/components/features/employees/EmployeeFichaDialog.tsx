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
import { Checkbox } from '@/components/ui/checkbox';
import { useEmployees } from '@/hooks/useEmployees';
import { EMPLOYEE_POSITIONS, HR_STATUS_OPTIONS } from '@/constants/employees';
import type { Employee } from '@/types/employee.types';

function formatPhone(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length === 0) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const schema = z.object({
    name: z.string().min(2, 'Nome deve ter no minimo 2 caracteres'),
    last_name: z.string().optional().or(z.literal('')),
    is_volante: z.boolean(),
    works_in_galpon: z.boolean(),
    position: z.string().optional(),
    birth_date: z.string().optional().or(z.literal('')),
    entry_date: z.string().optional().or(z.literal('')),
    phone: z.string().max(20).optional().or(z.literal('')),
    email: z.string().email('E-mail invalido').optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),
    pix_key: z.string().optional().or(z.literal('')),
    bank_account: z.string().optional().or(z.literal('')),
    transport_allowance: z.string().optional().or(z.literal('')),
    vacation_month: z.number().min(1).max(12).nullable().optional(),
    hr_status: z.enum(['active', 'away', 'dismissed']),
});

type FormData = z.infer<typeof schema>;

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
            {children}
        </p>
    );
}

interface EmployeeFichaDialogProps {
    employee: Employee | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EmployeeFichaDialog({ employee, open, onOpenChange }: EmployeeFichaDialogProps) {
    const { updateEmployee, isUpdating } = useEmployees();

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
    });

    useEffect(() => {
        if (open && employee) {
            reset({
                name: employee.name,
                last_name: employee.last_name ?? '',
                is_volante: employee.is_volante,
                works_in_galpon: employee.works_in_galpon,
                position: employee.position ?? undefined,
                birth_date: employee.birth_date ?? '',
                entry_date: employee.entry_date ?? '',
                phone: employee.phone ? formatPhone(employee.phone) : '',
                email: employee.email ?? '',
                address: employee.address ?? '',
                pix_key: employee.pix_key ?? '',
                bank_account: employee.bank_account ?? '',
                transport_allowance: employee.transport_allowance ?? '',
                vacation_month: employee.vacation_month ?? null,
                hr_status: (employee.hr_status ?? (employee.is_active ? 'active' : 'dismissed')) as 'active' | 'away' | 'dismissed',
            });
        }
    }, [open, employee, reset]);

    const currentPosition = watch('position');
    const currentHrStatus = watch('hr_status');
    const currentVacationMonth = watch('vacation_month');
    const isVolante = watch('is_volante');
    const worksInGalpon = watch('works_in_galpon');

    const onSubmit = (data: FormData) => {
        if (!employee) return;
        updateEmployee(
            {
                id: employee.id,
                payload: {
                    name: data.name,
                    last_name: data.last_name || null,
                    is_volante: data.is_volante,
                    works_in_galpon: data.works_in_galpon,
                    position: data.position || null,
                    birth_date: data.birth_date || null,
                    phone: data.phone || null,
                    email: data.email || null,
                    address: data.address || null,
                    pix_key: data.pix_key || null,
                    bank_account: data.bank_account || null,
                    transport_allowance: data.transport_allowance || null,
                    entry_date: data.entry_date || null,
                    vacation_month: data.vacation_month ?? null,
                    hr_status: data.hr_status,
                    is_active: data.hr_status === 'active',
                },
            },
            { onSuccess: () => onOpenChange(false) }
        );
    };

    if (!employee) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl overflow-y-auto max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>Ficha do Funcionario</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        {/* Nome */}
                        <div className="space-y-2">
                            <label htmlFor="ficha-name" className="text-sm font-medium">Nome <span className="text-red-500">*</span></label>
                            <Input id="ficha-name" {...register('name')} placeholder="Ex: Jean" />
                            {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
                        </div>

                        {/* Sobrenome */}
                        <div className="space-y-2">
                            <label htmlFor="ficha-last-name" className="text-sm font-medium">Sobrenome</label>
                            <Input id="ficha-last-name" {...register('last_name')} placeholder="Ex: Silva" />
                        </div>

                        {/* ID (readonly) */}
                        <div className="space-y-2">
                            <label htmlFor="ficha-id" className="text-sm font-medium">ID Funcionario</label>
                            <Input id="ficha-id" value={employee.id.toString()} disabled className="bg-muted/50 font-mono" />
                        </div>

                        {/* Cargo */}
                        <div className="space-y-2">
                            <label htmlFor="ficha-position" className="text-sm font-medium">Cargo</label>
                            <Select
                                value={currentPosition || 'none'}
                                onValueChange={(v) => setValue('position', v === 'none' ? undefined : v)}
                            >
                                <SelectTrigger id="ficha-position">
                                    <SelectValue placeholder="Selecione o cargo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Sem cargo definido</SelectItem>
                                    {EMPLOYEE_POSITIONS.map((pos) => (
                                        <SelectItem key={pos.value} value={pos.value}>{pos.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Loja (readonly) */}
                        <div className="col-span-2 space-y-2">
                            <label htmlFor="ficha-store" className="text-sm font-medium">Loja</label>
                            <Input id="ficha-store" value={employee.store_name || 'N/A'} disabled className="bg-muted/50" />
                        </div>
                    </div>

                    {/* Tipo de Alocação */}
                    <div className="space-y-2">
                        <SectionLabel>Tipo de Alocacao</SectionLabel>
                        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="ficha-is-volante"
                                    checked={isVolante}
                                    onCheckedChange={(c) => setValue('is_volante', c === true)}
                                />
                                <div className="space-y-0.5">
                                    <label htmlFor="ficha-is-volante" className="text-sm font-medium cursor-pointer">
                                        Funcionario Volante
                                    </label>
                                    <p className="text-xs text-muted-foreground">Aparece em todas as lojas nas ordens de servico</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="ficha-works-galpon"
                                    checked={worksInGalpon}
                                    onCheckedChange={(c) => setValue('works_in_galpon', c === true)}
                                />
                                <div className="space-y-0.5">
                                    <label htmlFor="ficha-works-galpon" className="text-sm font-medium cursor-pointer">
                                        Trabalha no Galpao
                                    </label>
                                    <p className="text-xs text-muted-foreground">Aparece em ordens de servico do galpao</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Dados Pessoais */}
                    <div className="space-y-3">
                        <SectionLabel>Dados Pessoais</SectionLabel>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="ficha-birth" className="text-sm font-medium">Data de Nascimento</label>
                                <Input id="ficha-birth" type="date" {...register('birth_date')} />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ficha-phone" className="text-sm font-medium">Telefone</label>
                                <Input
                                    id="ficha-phone"
                                    value={watch('phone') ?? ''}
                                    onChange={(e) => setValue('phone', formatPhone(e.target.value))}
                                    placeholder="(11) 99999-9999"
                                    inputMode="numeric"
                                />
                                {errors.phone && <p className="text-sm text-red-500">{errors.phone.message}</p>}
                            </div>
                            <div className="col-span-2 space-y-2">
                                <label htmlFor="ficha-address" className="text-sm font-medium">Endereco</label>
                                <Input id="ficha-address" {...register('address')} placeholder="Rua, numero, bairro, cidade" />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ficha-entry" className="text-sm font-medium">Data de Entrada</label>
                                <Input id="ficha-entry" type="date" {...register('entry_date')} />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ficha-email" className="text-sm font-medium">E-mail</label>
                                <Input id="ficha-email" type="email" {...register('email')} placeholder="funcionario@email.com" />
                                {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
                            </div>
                        </div>
                    </div>

                    {/* Financeiro */}
                    <div className="space-y-3">
                        <SectionLabel>Financeiro</SectionLabel>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="ficha-pix" className="text-sm font-medium">Chave PIX</label>
                                <Input id="ficha-pix" {...register('pix_key')} placeholder="CPF, e-mail ou telefone" />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ficha-bank" className="text-sm font-medium">Conta Bancaria</label>
                                <Input id="ficha-bank" {...register('bank_account')} placeholder="Banco - Ag / Conta" />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ficha-transport" className="text-sm font-medium">Transporte/mes (R$)</label>
                                <Input
                                    id="ficha-transport"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    {...register('transport_allowance')}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                    </div>

                    {/* RH */}
                    <div className="space-y-3">
                        <SectionLabel>RH</SectionLabel>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="ficha-vacation" className="text-sm font-medium">Mes previsto de ferias</label>
                                <Select
                                    value={currentVacationMonth != null ? currentVacationMonth.toString() : 'none'}
                                    onValueChange={(v) => setValue('vacation_month', v === 'none' ? null : parseInt(v))}
                                >
                                    <SelectTrigger id="ficha-vacation">
                                        <SelectValue placeholder="Nao definido" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Nao definido</SelectItem>
                                        {MONTH_NAMES.map((month, index) => (
                                            <SelectItem key={index + 1} value={(index + 1).toString()}>
                                                {month}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ficha-hr-status" className="text-sm font-medium">Status</label>
                                <Select
                                    value={currentHrStatus || 'active'}
                                    onValueChange={(v) => setValue('hr_status', v as 'active' | 'away' | 'dismissed')}
                                >
                                    <SelectTrigger id="ficha-hr-status">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {HR_STATUS_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Fechar
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
