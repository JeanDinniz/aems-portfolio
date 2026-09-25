import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorStatus } from '@/lib/api-error';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useEmployees } from '@/hooks/useEmployees';
import { useStores } from '@/hooks/useStores';
import { UserCombobox } from './UserCombobox';
import type { Employee } from '@/types/employee.types';
import { EMPLOYEE_POSITIONS, positionToDepartment } from '@/constants/employees';

function formatPhone(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length === 0) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const schema = z.object({
    name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
    position: z.string().optional(),
    is_volante: z.boolean(),
    works_in_galpon: z.boolean(),
    // Transfer
    new_store_id: z.number().optional(),
    // Personal
    entry_date: z.string().optional(),
    phone: z.string().max(20, 'Máximo 20 caracteres').optional().or(z.literal('')),
    email: z.string().email('E-mail inválido').optional().or(z.literal('')),
    cpf: z.string().max(14).optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),
    // Financial
    pix_key: z.string().optional().or(z.literal('')),
    bank_account: z.string().optional().or(z.literal('')),
    transport_allowance: z.string().optional().or(z.literal('')),
    // HR
    vacation_month: z.number().min(1).max(12).nullable().optional(),
    dismissal_date: z.string().optional().or(z.literal('')),
    dismissal_reason: z.string().optional().or(z.literal('')),
    would_rehire: z.enum(['true', 'false', '__none__']).optional(),
    // Ponto Eletrônico
    user_id: z.number().nullable().optional(),
    work_start_time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal('')),
    work_end_time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

interface Props {
    employee: Employee;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
            {children}
        </p>
    );
}

export function EditEmployeeDialog({ employee, open, onOpenChange }: Props) {
    const { updateEmployee, isUpdating } = useEmployees();
    const { allStores } = useStores();
    const { toast } = useToast();
    const [showTransfer, setShowTransfer] = useState(false);

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors },
    } = useForm<FormData>({ resolver: zodResolver(schema) });

    useEffect(() => {
        if (open) {
            setShowTransfer(false);
            reset({
                name: employee.name,
                position: employee.position ?? undefined,
                is_volante: employee.is_volante,
                works_in_galpon: employee.works_in_galpon,
                new_store_id: undefined,
                entry_date: employee.entry_date ?? '',
                phone: employee.phone ? formatPhone(employee.phone) : '',
                email: employee.email ?? '',
                cpf: employee.cpf ?? '',
                address: employee.address ?? '',
                pix_key: employee.pix_key ?? '',
                bank_account: employee.bank_account ?? '',
                transport_allowance: employee.transport_allowance ?? '',
                vacation_month: employee.vacation_month ?? undefined,
                dismissal_date: employee.dismissal_date ?? '',
                dismissal_reason: employee.dismissal_reason ?? '',
                would_rehire:
                    employee.would_rehire === true
                        ? 'true'
                        : employee.would_rehire === false
                        ? 'false'
                        : '__none__',
                user_id: employee.user_id ?? null,
                work_start_time: employee.work_start_time ?? '',
                work_end_time: employee.work_end_time ?? '',
            });
        }
    }, [open, employee, reset]);

    const currentPosition = watch('position');
    const isVolante = watch('is_volante');
    const worksInGalpon = watch('works_in_galpon');
    const newStoreId = watch('new_store_id');
    const currentUserId = watch('user_id') ?? null;

    const onSubmit = (data: FormData) => {
        const payload = {
            name: data.name,
            position: data.position || null,
            department: positionToDepartment(data.position) ?? null,
            is_volante: data.is_volante,
            works_in_galpon: data.works_in_galpon,
            ...(showTransfer && data.new_store_id ? { store_id: data.new_store_id } : {}),
            entry_date: data.entry_date || null,
            phone: data.phone || null,
            email: data.email || null,
            cpf: data.cpf || null,
            address: data.address || null,
            pix_key: data.pix_key || null,
            bank_account: data.bank_account || null,
            transport_allowance: data.transport_allowance || null,
            vacation_month: data.vacation_month ?? null,
            ...((!employee.is_active) ? {
                dismissal_date: data.dismissal_date || null,
                dismissal_reason: data.dismissal_reason || null,
                would_rehire:
                    data.would_rehire === 'true'
                        ? true
                        : data.would_rehire === 'false'
                        ? false
                        : null,
            } : {}),
            // Ponto Eletrônico — desvincular quando havia vínculo e agora é null
            ...(data.user_id == null && employee.user_id != null
                ? { clear_user: true }
                : data.user_id != null
                ? { user_id: data.user_id }
                : {}),
            work_start_time: data.work_start_time || null,
            work_end_time: data.work_end_time || null,
        };

        updateEmployee(
            { id: employee.id, payload },
            {
                onSuccess: () => onOpenChange(false),
                onError: (err) => {
                    if (getApiErrorStatus(err as Error) === 409) {
                        toast({
                            variant: 'destructive',
                            title: 'Usuário já vinculado',
                            description: 'Usuário já vinculado a outro funcionário.',
                        });
                    }
                },
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>Editar Funcionário</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

                    {/* ── Identificação ── */}
                    <div className="space-y-3">
                        <SectionLabel>Identificação</SectionLabel>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="ee-name" className="text-sm font-medium">Nome Completo</label>
                                <Input id="ee-name" {...register('name')} />
                                {errors.name && (
                                    <p className="text-sm text-red-500">{errors.name.message}</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="ee-position" className="text-sm font-medium">Cargo</label>
                                <Select
                                    value={currentPosition || 'none'}
                                    onValueChange={(v) => setValue('position', v === 'none' ? undefined : v)}
                                >
                                    <SelectTrigger id="ee-position">
                                        <SelectValue placeholder="Selecione o cargo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Sem cargo definido</SelectItem>
                                        {EMPLOYEE_POSITIONS.map((pos) => (
                                            <SelectItem key={pos.value} value={pos.value}>
                                                {pos.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Instaladores de Película aparecem somente em OS de Película.
                                </p>
                            </div>
                        </div>

                        {/* Loja atual (readonly) */}
                        <div className="space-y-2">
                            <label htmlFor="ee-store-display" className="text-sm font-medium">Loja Atual</label>
                            <Input id="ee-store-display" value={employee.store_name || 'N/A'} disabled className="bg-muted/50" />
                        </div>

                        {/* Checkboxes de tipo */}
                        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="ee-is-volante"
                                    checked={isVolante}
                                    onCheckedChange={(c) => setValue('is_volante', c === true)}
                                />
                                <div className="space-y-0.5">
                                    <label htmlFor="ee-is-volante" className="text-sm font-medium cursor-pointer">
                                        Funcionário Volante
                                    </label>
                                    <p className="text-xs text-muted-foreground">
                                        Aparece em todas as lojas nas ordens de serviço
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="ee-works-galpon"
                                    checked={worksInGalpon}
                                    onCheckedChange={(c) => setValue('works_in_galpon', c === true)}
                                />
                                <div className="space-y-0.5">
                                    <label htmlFor="ee-works-galpon" className="text-sm font-medium cursor-pointer">
                                        Trabalha no Galpão
                                    </label>
                                    <p className="text-xs text-muted-foreground">
                                        Aparece em ordens de serviço do galpão
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Transferência de Loja ── */}
                    <div className="space-y-3">
                        <SectionLabel>Transferência</SectionLabel>

                        {!showTransfer ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowTransfer(true)}
                            >
                                Transferir de loja
                            </Button>
                        ) : (
                            <div className="space-y-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
                                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    <p className="text-xs font-medium">
                                        Isso irá transferir o funcionário para outra loja
                                    </p>
                                </div>
                                <Select
                                    value={newStoreId?.toString() ?? ''}
                                    onValueChange={(v) => setValue('new_store_id', parseInt(v))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione a nova loja" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allStores
                                            .filter((s) => s.id !== employee.store_id)
                                            .map((store) => (
                                                <SelectItem key={store.id} value={store.id.toString()}>
                                                    {store.name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7"
                                    onClick={() => { setShowTransfer(false); setValue('new_store_id', undefined); }}
                                >
                                    Cancelar transferência
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* ── Dados Pessoais ── */}
                    <div className="space-y-3">
                        <SectionLabel>Dados Pessoais</SectionLabel>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="ee-entry-date" className="text-sm font-medium">Data de Entrada</label>
                                <Input id="ee-entry-date" type="date" {...register('entry_date')} />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ee-phone" className="text-sm font-medium">Telefone</label>
                                <Input
                                    id="ee-phone"
                                    value={watch('phone') ?? ''}
                                    onChange={(e) => setValue('phone', formatPhone(e.target.value), { shouldValidate: true })}
                                    placeholder="(11) 99999-9999"
                                    inputMode="numeric"
                                />
                                {errors.phone && (
                                    <p className="text-sm text-red-500">{errors.phone.message}</p>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="ee-email" className="text-sm font-medium">E-mail</label>
                            <Input id="ee-email" type="email" {...register('email')} placeholder="funcionario@email.com" />
                            {errors.email && (
                                <p className="text-sm text-red-500">{errors.email.message}</p>
                            )}
                        </div>

                        <div className="space-y-2 sm:max-w-[50%]">
                            <label htmlFor="ee-cpf" className="text-sm font-medium">
                                CPF
                                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                                    (necessário para arquivos fiscais do ponto)
                                </span>
                            </label>
                            <Input
                                id="ee-cpf"
                                {...register('cpf')}
                                placeholder="000.000.000-00"
                                inputMode="numeric"
                            />
                            {errors.cpf && (
                                <p className="text-sm text-red-500">{errors.cpf.message}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="ee-address" className="text-sm font-medium">Endereço</label>
                            <Input id="ee-address" {...register('address')} placeholder="Rua, número, bairro, cidade" />
                        </div>
                    </div>

                    {/* ── Financeiro ── */}
                    <div className="space-y-3">
                        <SectionLabel>Financeiro</SectionLabel>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="ee-pix-key" className="text-sm font-medium">Chave PIX</label>
                                <Input id="ee-pix-key" {...register('pix_key')} placeholder="CPF, e-mail ou telefone" />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ee-bank-account" className="text-sm font-medium">Conta Bancária</label>
                                <Input id="ee-bank-account" {...register('bank_account')} placeholder="Banco - Ag / Conta" />
                            </div>
                        </div>

                        <div className="space-y-2 sm:max-w-[50%]">
                            <label htmlFor="ee-transport" className="text-sm font-medium">Transporte/mês (R$)</label>
                            <Input
                                id="ee-transport"
                                type="number"
                                step="0.01"
                                min="0"
                                {...register('transport_allowance')}
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    {/* ── RH ── */}
                    <div className="space-y-3">
                        <SectionLabel>RH</SectionLabel>

                        <div className="space-y-2 sm:max-w-[50%]">
                            <label htmlFor="ee-vacation-month" className="text-sm font-medium">Mês previsto de férias</label>
                            <Select
                                value={watch('vacation_month') != null ? watch('vacation_month')!.toString() : '__none__'}
                                onValueChange={(v) =>
                                    setValue('vacation_month', v === '__none__' ? null : parseInt(v))
                                }
                            >
                                <SelectTrigger id="ee-vacation-month">
                                    <SelectValue placeholder="Não definido" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">Não definido</SelectItem>
                                    {MONTH_NAMES.map((month, idx) => (
                                        <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                                            {month}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {!employee.is_active && (
                            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    Dados de Desligamento
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <label htmlFor="ee-dismissal-date" className="text-sm font-medium">Data de Demissão</label>
                                        <Input id="ee-dismissal-date" type="date" {...register('dismissal_date')} />
                                    </div>
                                    <div className="space-y-2">
                                        <label htmlFor="ee-would-rehire" className="text-sm font-medium">Recontrataria?</label>
                                        <Select
                                            value={watch('would_rehire') ?? '__none__'}
                                            onValueChange={(v) =>
                                                setValue('would_rehire', v as 'true' | 'false' | '__none__')
                                            }
                                        >
                                            <SelectTrigger id="ee-would-rehire">
                                                <SelectValue placeholder="Não informado" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__none__">Não informado</SelectItem>
                                                <SelectItem value="true">Sim</SelectItem>
                                                <SelectItem value="false">Não</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="ee-dismissal-reason" className="text-sm font-medium">Motivo da Demissão</label>
                                    <Textarea
                                        id="ee-dismissal-reason"
                                        {...register('dismissal_reason')}
                                        placeholder="Descreva o motivo do desligamento"
                                        rows={2}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Ponto Eletrônico ── */}
                    <div className="space-y-3">
                        <SectionLabel>Ponto Eletrônico</SectionLabel>

                        <div className="space-y-2">
                            <p className="text-sm font-medium">Usuário do Sistema</p>
                            <UserCombobox
                                value={currentUserId}
                                onChange={(userId) => setValue('user_id', userId)}
                                currentUserLabel={employee.user_name}
                            />
                            <p className="text-xs text-muted-foreground">
                                Vincula o funcionário a um usuário para que ele possa bater ponto.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="ee-work-start" className="text-sm font-medium">Hora de Entrada</label>
                                <Input
                                    id="ee-work-start"
                                    type="time"
                                    {...register('work_start_time')}
                                    placeholder="08:00"
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="ee-work-end" className="text-sm font-medium">Hora de Saída</label>
                                <Input
                                    id="ee-work-end"
                                    type="time"
                                    {...register('work_end_time')}
                                    placeholder="18:00"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isUpdating}>
                            {isUpdating ? 'Salvando...' : 'Salvar Alterações'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
