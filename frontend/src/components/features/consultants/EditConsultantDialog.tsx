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
import { useConsultants } from '@/hooks/useConsultants';
import { useStores } from '@/hooks/useStores';
import type { Consultant } from '@/types/consultant.types';

const editConsultantSchema = z.object({
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

type EditConsultantForm = z.infer<typeof editConsultantSchema>;

interface EditConsultantDialogProps {
    consultant: Consultant;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EditConsultantDialog({ consultant, open, onOpenChange }: EditConsultantDialogProps) {
    const { updateConsultant, isUpdating } = useConsultants();
    const { stores } = useStores();

    const {
        register,
        handleSubmit,
        reset,
        setValue,
        watch,
        formState: { errors },
    } = useForm<EditConsultantForm>({
        resolver: zodResolver(editConsultantSchema),
    });

    const selectedStoreId = watch('store_id');
    const bankAccountType = watch('bank_account_type');

    useEffect(() => {
        if (open && consultant) {
            reset({
                name: consultant.name,
                store_id: consultant.store_id,
                phone: consultant.phone || '',
                email: consultant.email || '',
                pix_key: consultant.pix_key || '',
                bank_name: consultant.bank_name || '',
                bank_agency: consultant.bank_agency || '',
                bank_account: consultant.bank_account || '',
                bank_account_type: consultant.bank_account_type ?? undefined,
            });
        }
    }, [open, consultant, reset]);

    const onSubmit = (data: EditConsultantForm) => {
        updateConsultant({
            id: consultant.id,
            payload: {
                name: data.name,
                store_id: data.store_id,
                phone: data.phone || undefined,
                email: data.email || undefined,
                pix_key: data.pix_key || null,
                bank_name: data.bank_name || null,
                bank_agency: data.bank_agency || null,
                bank_account: data.bank_account || null,
                bank_account_type: data.bank_account_type ?? null,
            },
        }, {
            onSuccess: () => onOpenChange(false),
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Editar Consultor</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Dados básicos */}
                    <div className="space-y-2">
                        <label htmlFor="ec-name" className="text-sm font-medium">
                            Nome <span className="text-red-500">*</span>
                        </label>
                        <Input id="ec-name" {...register('name')} />
                        {errors.name && (
                            <p className="text-sm text-red-500">{errors.name.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="ec-store" className="text-sm font-medium">
                            Loja <span className="text-red-500">*</span>
                        </label>
                        <Select
                            value={selectedStoreId?.toString()}
                            onValueChange={(val) => setValue('store_id', parseInt(val))}
                        >
                            <SelectTrigger id="ec-store">
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
                        {errors.store_id && (
                            <p className="text-sm text-red-500">{errors.store_id.message}</p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label htmlFor="ec-phone" className="text-sm font-medium">Telefone</label>
                            <Input
                                id="ec-phone"
                                {...register('phone')}
                                placeholder="(00) 00000-0000"
                                type="tel"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="ec-email" className="text-sm font-medium">E-mail</label>
                            <Input
                                id="ec-email"
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
                            <label htmlFor="ec-pix" className="text-sm font-medium">Chave PIX</label>
                            <Input
                                id="ec-pix"
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
                                    <label htmlFor="ec-bank-name" className="text-xs text-[#666666] dark:text-zinc-400">Banco</label>
                                    <Input
                                        id="ec-bank-name"
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
                                    <label htmlFor="ec-agency" className="text-xs text-[#666666] dark:text-zinc-400">Agência</label>
                                    <Input
                                        id="ec-agency"
                                        {...register('bank_agency')}
                                        placeholder="0001"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="ec-account" className="text-xs text-[#666666] dark:text-zinc-400">Conta + Dígito</label>
                                    <Input
                                        id="ec-account"
                                        {...register('bank_account')}
                                        placeholder="12345-6"
                                    />
                                </div>
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
