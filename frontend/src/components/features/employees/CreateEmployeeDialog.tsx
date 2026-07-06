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
import { useStores } from '@/hooks/useStores';
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
    'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const schema = z.object({
    first_name: z.string().min(2, 'Nome deve ter no minimo 2 caracteres'),
    last_name: z.string().optional().or(z.literal('')),
    store_id: z.number({ error: 'Loja e obrigatoria' }),
    position: z.string().optional(),
    is_volante: z.boolean(),
    works_in_galpon: z.boolean(),
    // Pessoal
    birth_date: z.string().optional().or(z.literal('')),
    entry_date: z.string().optional(),
    phone: z.string().max(20, 'Maximo 20 caracteres').optional().or(z.literal('')),
    email: z.string().email('E-mail invalido').optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),
    // Financeiro
    pix_key: z.string().optional().or(z.literal('')),
    bank_account: z.string().optional().or(z.literal('')),
    transport_allowance: z.string().optional().or(z.literal('')),
    // RH
    vacation_month: z.number().min(1).max(12).nullable().optional(),
});

type FormData = z.infer<typeof schema>;

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
            {children}
        </p>
    );
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CreateEmployeeDialog({ open, onOpenChange }: Props) {
    const { createEmployee, isCreating } = useEmployees();
    const { stores } = useStores();

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        formState: { errors },
        reset,
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { is_volante: false, works_in_galpon: false },
    });

    const isVolante = watch('is_volante');
    const worksInGalpon = watch('works_in_galpon');

    const onSubmit = (data: FormData) => {
        const lastName = data.last_name?.trim() ?? '';
        const fullName = lastName ? `${data.first_name.trim()} ${lastName}` : data.first_name.trim();

        createEmployee({
            name: fullName,
            store_id: data.store_id,
            position: data.position || undefined,
            department: positionToDepartment(data.position),
            is_volante: data.is_volante,
            works_in_galpon: data.works_in_galpon,
            entry_date: data.entry_date || null,
            phone: data.phone || null,
            email: data.email || null,
            address: data.address || null,
            pix_key: data.pix_key || null,
            bank_account: data.bank_account || null,
            transport_allowance: data.transport_allowance || null,
            vacation_month: data.vacation_month ?? null,
        } as Parameters<typeof createEmployee>[0], {
            onSuccess: () => { reset(); onOpenChange(false); },
        });
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
            <DialogContent className="max-w-xl overflow-y-auto max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>Novo Funcionario</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

                    {/* Identificacao */}
                    <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="cre-first-name" className="text-sm font-medium">
                                    Nome <span className="text-red-500">*</span>
                                </label>
                                <Input id="cre-first-name" {...register('first_name')} placeholder="Ex: Jean" />
                                {errors.first_name && <p className="text-sm text-red-500">{errors.first_name.message}</p>}
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="cre-last-name" className="text-sm font-medium">Sobrenome</label>
                                <Input id="cre-last-name" {...register('last_name')} placeholder="Ex: Silva" />
                            </div>
                        </div>

                        {/* Tipo de Alocacao */}
                        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Tipo de Alocacao
                            </p>
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="cre-is-volante"
                                    checked={isVolante}
                                    onCheckedChange={(c) => setValue('is_volante', c === true)}
                                />
                                <div className="space-y-0.5">
                                    <label htmlFor="cre-is-volante" className="text-sm font-medium cursor-pointer">
                                        Funcionario Volante
                                    </label>
                                    <p className="text-xs text-muted-foreground">
                                        Aparece em todas as lojas nas ordens de servico
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="cre-works-galpon"
                                    checked={worksInGalpon}
                                    onCheckedChange={(c) => setValue('works_in_galpon', c === true)}
                                />
                                <div className="space-y-0.5">
                                    <label htmlFor="cre-works-galpon" className="text-sm font-medium cursor-pointer">
                                        Trabalha no Galpao
                                    </label>
                                    <p className="text-xs text-muted-foreground">
                                        Aparece em ordens de servico do galpao
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Loja */}
                            <div className="space-y-2">
                                <label htmlFor="cre-store" className="text-sm font-medium">
                                    {isVolante ? 'Loja Base (Referencia)' : 'Loja'}{' '}
                                    <span className="text-red-500">*</span>
                                </label>
                                <Select onValueChange={(v) => setValue('store_id', parseInt(v))}>
                                    <SelectTrigger id="cre-store">
                                        <SelectValue placeholder="Selecione a loja" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {stores?.map((store) => (
                                            <SelectItem key={store.id} value={store.id.toString()}>
                                                {store.code} - {store.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {errors.store_id && <p className="text-sm text-red-500">{errors.store_id.message}</p>}
                            </div>

                            {/* Cargo */}
                            <div className="space-y-2">
                                <label htmlFor="cre-position" className="text-sm font-medium">Cargo</label>
                                <Select onValueChange={(v) => setValue('position', v === 'none' ? undefined : v)}>
                                    <SelectTrigger id="cre-position">
                                        <SelectValue placeholder="Selecione o cargo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Sem cargo definido</SelectItem>
                                        {EMPLOYEE_POSITIONS.map((pos) => (
                                            <SelectItem key={pos.value} value={pos.value}>{pos.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Instaladores de Pelicula aparecem somente em OS de Pelicula.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Dados Pessoais */}
                    <div className="space-y-3">
                        <SectionLabel>Dados Pessoais</SectionLabel>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="cre-birth-date" className="text-sm font-medium">Data de Nascimento</label>
                                <Input id="cre-birth-date" type="date" {...register('birth_date')} />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="cre-phone" className="text-sm font-medium">Telefone</label>
                                <Input
                                    id="cre-phone"
                                    value={watch('phone') ?? ''}
                                    onChange={(e) => setValue('phone', formatPhone(e.target.value), { shouldValidate: true })}
                                    placeholder="(11) 99999-9999"
                                    inputMode="numeric"
                                />
                                {errors.phone && <p className="text-sm text-red-500">{errors.phone.message}</p>}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="cre-address" className="text-sm font-medium">Endereco</label>
                            <Input id="cre-address" {...register('address')} placeholder="Rua, numero, bairro, cidade" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="cre-entry-date" className="text-sm font-medium">Data de Entrada</label>
                                <Input id="cre-entry-date" type="date" {...register('entry_date')} />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="cre-email" className="text-sm font-medium">E-mail</label>
                                <Input id="cre-email" type="email" {...register('email')} placeholder="funcionario@email.com" />
                                {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
                            </div>
                        </div>
                    </div>

                    {/* Financeiro */}
                    <div className="space-y-3">
                        <SectionLabel>Financeiro</SectionLabel>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label htmlFor="cre-pix-key" className="text-sm font-medium">Chave PIX</label>
                                <Input id="cre-pix-key" {...register('pix_key')} placeholder="CPF, e-mail ou telefone" />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="cre-bank-account" className="text-sm font-medium">Conta Bancaria</label>
                                <Input id="cre-bank-account" {...register('bank_account')} placeholder="Banco - Ag / Conta" />
                            </div>
                        </div>

                        <div className="space-y-2 sm:max-w-[50%]">
                            <label htmlFor="cre-transport" className="text-sm font-medium">Transporte/mes (R$)</label>
                            <Input id="cre-transport" type="number" step="0.01" min="0" {...register('transport_allowance')} placeholder="0.00" />
                        </div>
                    </div>

                    {/* RH */}
                    <div className="space-y-3">
                        <SectionLabel>RH</SectionLabel>

                        <div className="space-y-2 sm:max-w-[50%]">
                            <label htmlFor="cre-vacation-month" className="text-sm font-medium">Mes previsto de ferias</label>
                            <Select
                                value={watch('vacation_month') != null ? watch('vacation_month')!.toString() : '__none__'}
                                onValueChange={(v) => setValue('vacation_month', v === '__none__' ? null : parseInt(v))}
                            >
                                <SelectTrigger id="cre-vacation-month">
                                    <SelectValue placeholder="Nao definido" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">Nao definido</SelectItem>
                                    {MONTH_NAMES.map((month, idx) => (
                                        <SelectItem key={idx + 1} value={(idx + 1).toString()}>{month}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isCreating}>
                            {isCreating ? 'Cadastrando...' : 'Cadastrar Funcionario'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
