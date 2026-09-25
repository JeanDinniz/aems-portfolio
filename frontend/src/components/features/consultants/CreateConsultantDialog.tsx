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
import { useConsultants } from '@/hooks/useConsultants';
import { useStores } from '@/hooks/useStores';

const createConsultantSchema = z.object({
    name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
    store_id: z.number({ error: 'Loja é obrigatória' }),
    phone: z.string().optional(),
    email: z.string().email('E-mail inválido').optional().or(z.literal('')),
    // PIX
    pix_key: z.string().max(200).optional().or(z.literal('')),
    // Conta bancária
    bank_name: z.string().max(100).optional().or(z.literal('')),
    bank_agency: z.string().max(20).optional().or(z.literal('')),
    bank_account: z.string().max(30).optional().or(z.literal('')),
    bank_account_type: z.enum(['corrente', 'poupanca']).optional(),
});

type CreateConsultantForm = z.infer<typeof createConsultantSchema>;

interface CreateConsultantDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CreateConsultantDialog({ open, onOpenChange }: CreateConsultantDialogProps) {
    const { createConsultant, isCreating } = useConsultants();
    const { stores } = useStores();

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        formState: { errors },
        reset,
    } = useForm<CreateConsultantForm>({
        resolver: zodResolver(createConsultantSchema),
    });

    const bankAccountType = watch('bank_account_type');

    const onSubmit = (data: CreateConsultantForm) => {
        const payload = {
            name: data.name,
            store_id: data.store_id,
            phone: data.phone || undefined,
            email: data.email || undefined,
            pix_key: data.pix_key || undefined,
            bank_name: data.bank_name || undefined,
            bank_agency: data.bank_agency || undefined,
            bank_account: data.bank_account || undefined,
            bank_account_type: data.bank_account_type || undefined,
        };

        createConsultant(payload, {
            onSuccess: () => {
                reset();
                onOpenChange(false);
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Novo Consultor</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Dados básicos */}
                    <div className="space-y-2">
                        <label htmlFor="cc-name" className="text-sm font-medium">
                            Nome <span className="text-red-500">*</span>
                        </label>
                        <Input
                            id="cc-name"
                            {...register('name')}
                            placeholder="Ex: João da Silva"
                        />
                        {errors.name && (
                            <p className="text-sm text-red-500">{errors.name.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="cc-store" className="text-sm font-medium">
                            Loja <span className="text-red-500">*</span>
                        </label>
                        <Select onValueChange={(value) => setValue('store_id', parseInt(value))}>
                            <SelectTrigger id="cc-store">
                                <SelectValue placeholder="Selecione a loja" />
                            </SelectTrigger>
                            <SelectContent>
                                {stores?.map((store) => (
                                    <SelectItem key={store.id} value={store.id.toString()}>
                                        {store.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.store_id && (
                            <p className="text-sm text-red-500">{errors.store_id.message}</p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label htmlFor="cc-phone" className="text-sm font-medium">Telefone</label>
                            <Input
                                id="cc-phone"
                                {...register('phone')}
                                placeholder="(00) 00000-0000"
                                type="tel"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="cc-email" className="text-sm font-medium">E-mail</label>
                            <Input
                                id="cc-email"
                                type="email"
                                {...register('email')}
                                placeholder="email@exemplo.com"
                            />
                            {errors.email && (
                                <p className="text-sm text-red-500">{errors.email.message}</p>
                            )}
                        </div>
                    </div>

                    {/* Dados de pagamento */}
                    <div className="border border-dashed border-[#D1D1D1] dark:border-[#333333] rounded-lg p-4 space-y-4">
                        <p className="text-sm font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide">
                            Dados de Pagamento <span className="font-normal normal-case">(opcional)</span>
                        </p>

                        {/* PIX */}
                        <div className="space-y-2">
                            <label htmlFor="cc-pix" className="text-sm font-medium">Chave PIX</label>
                            <Input
                                id="cc-pix"
                                {...register('pix_key')}
                                placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
                            />
                            <p className="text-xs text-[#999999] dark:text-zinc-500">
                                Informe qualquer tipo de chave PIX cadastrada no banco.
                            </p>
                        </div>

                        {/* Conta Bancária */}
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Conta Bancária</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label htmlFor="cc-bank-name" className="text-xs text-[#666666] dark:text-zinc-400">Banco</label>
                                    <Input
                                        id="cc-bank-name"
                                        {...register('bank_name')}
                                        placeholder="Ex: Itaú, Bradesco, Nubank"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <span className="text-xs text-[#666666] dark:text-zinc-400">Tipo de Conta</span>
                                    <Select
                                        value={bankAccountType ?? ''}
                                        onValueChange={(val) => setValue('bank_account_type', val as 'corrente' | 'poupanca')}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="corrente">Corrente</SelectItem>
                                            <SelectItem value="poupanca">Poupança</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="cc-agency" className="text-xs text-[#666666] dark:text-zinc-400">Agência</label>
                                    <Input
                                        id="cc-agency"
                                        {...register('bank_agency')}
                                        placeholder="0001"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="cc-account" className="text-xs text-[#666666] dark:text-zinc-400">Conta + Dígito</label>
                                    <Input
                                        id="cc-account"
                                        {...register('bank_account')}
                                        placeholder="12345-6"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isCreating}>
                            {isCreating ? 'Criando...' : 'Criar Consultor'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
