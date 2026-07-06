import { useState, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Building2, Edit, MoreHorizontal, Plus, Search, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useSuppliersAdmin, useCreateSupplier, useUpdateSupplier, useDeactivateSupplier } from '@/hooks/useSuppliers';
import { suppliersService } from '@/services/api/suppliersService';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { getApiErrorMessage } from '@/lib/api-error';
import type { Supplier, SupplierCreate, SupplierUpdate } from '@/types/supplier';

// ---------------------------------------------------------------------------
// Schemas de validação
// ---------------------------------------------------------------------------

const supplierSchema = z.object({
    company_name: z.string().min(2, 'Razão social deve ter pelo menos 2 caracteres'),
    cnpj: z.string().max(18, 'CNPJ deve ter no máximo 18 caracteres').optional().or(z.literal('')),
    responsible: z.string().optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal('')),
    email: z.string().email('E-mail inválido').optional().or(z.literal('')),
    address: z.string().optional().or(z.literal('')),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;

// ---------------------------------------------------------------------------
// Dialog de criação
// ---------------------------------------------------------------------------

interface CreateSupplierDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function CreateSupplierDialog({ open, onOpenChange }: CreateSupplierDialogProps) {
    const createMutation = useCreateSupplier();

    const form = useForm<SupplierFormValues>({
        resolver: zodResolver(supplierSchema),
        defaultValues: {
            company_name: '',
            cnpj: '',
            responsible: '',
            phone: '',
            email: '',
            address: '',
        },
    });

    const onSubmit = useCallback(
        (values: SupplierFormValues) => {
            const payload: SupplierCreate = {
                company_name: values.company_name,
                cnpj: values.cnpj || null,
                responsible: values.responsible || null,
                phone: values.phone || null,
                email: values.email || null,
                address: values.address || null,
            };
            createMutation.mutate(payload, {
                onSuccess: () => {
                    onOpenChange(false);
                    form.reset();
                },
            });
        },
        [createMutation, form, onOpenChange]
    );

    const handleOpenChange = (open: boolean) => {
        if (!open) form.reset();
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[520px] bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                <DialogHeader>
                    <DialogTitle className="text-[#111111] dark:text-white">Novo Fornecedor</DialogTitle>
                    <DialogDescription className="text-[#666666] dark:text-zinc-400">
                        Cadastre um novo fornecedor no sistema.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="company_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Empresa *</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Razão social ou nome fantasia"
                                            className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="cnpj"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">CNPJ</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="00.000.000/0000-00"
                                                maxLength={18}
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="responsible"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">Responsavel</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Nome do contato"
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="phone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">Tel. / WhatsApp</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="(XX) XXXXX-XXXX"
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">E-mail</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="email"
                                                placeholder="contato@empresa.com"
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Endereco</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Rua, numero, bairro, cidade - UF"
                                            rows={2}
                                            className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800] resize-none"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                disabled={createMutation.isPending}
                                className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                disabled={createMutation.isPending}
                                className="font-semibold"
                                style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                            >
                                {createMutation.isPending ? 'Criando...' : 'Criar Fornecedor'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------
// Dialog de edição
// ---------------------------------------------------------------------------

const editSupplierSchema = supplierSchema.extend({
    is_active: z.boolean(),
});

type EditSupplierFormValues = z.infer<typeof editSupplierSchema>;

interface EditSupplierDialogProps {
    supplier: Supplier | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function EditSupplierDialog({ supplier, open, onOpenChange }: EditSupplierDialogProps) {
    const updateMutation = useUpdateSupplier();

    const form = useForm<EditSupplierFormValues>({
        resolver: zodResolver(editSupplierSchema),
        values: supplier
            ? {
                  company_name: supplier.company_name,
                  cnpj: supplier.cnpj ?? '',
                  responsible: supplier.responsible ?? '',
                  phone: supplier.phone ?? '',
                  email: supplier.email ?? '',
                  address: supplier.address ?? '',
                  is_active: supplier.is_active,
              }
            : undefined,
    });

    const onSubmit = useCallback(
        (values: EditSupplierFormValues) => {
            if (!supplier) return;
            const payload: SupplierUpdate = {
                company_name: values.company_name,
                cnpj: values.cnpj || null,
                responsible: values.responsible || null,
                phone: values.phone || null,
                email: values.email || null,
                address: values.address || null,
                is_active: values.is_active,
            };
            updateMutation.mutate({ id: supplier.id, payload }, {
                onSuccess: () => onOpenChange(false),
            });
        },
        [updateMutation, supplier, onOpenChange]
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px] bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                <DialogHeader>
                    <DialogTitle className="text-[#111111] dark:text-white">Editar Fornecedor</DialogTitle>
                    <DialogDescription className="text-[#666666] dark:text-zinc-400">
                        Atualize os dados de{' '}
                        <span className="font-semibold text-[#111111] dark:text-zinc-200">{supplier?.company_name}</span>.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="company_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Empresa *</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Razao social ou nome fantasia"
                                            className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="cnpj"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">CNPJ</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="00.000.000/0000-00"
                                                maxLength={18}
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="responsible"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">Responsavel</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Nome do contato"
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="phone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">Tel. / WhatsApp</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="(XX) XXXXX-XXXX"
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[#666666] dark:text-zinc-300">E-mail</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="email"
                                                placeholder="contato@empresa.com"
                                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Endereco</FormLabel>
                                    <FormControl>
                                        <Textarea
                                            placeholder="Rua, numero, bairro, cidade - UF"
                                            rows={2}
                                            className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800] resize-none"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="is_active"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Status</FormLabel>
                                    <Select
                                        onValueChange={(val) => field.onChange(val === 'true')}
                                        value={field.value ? 'true' : 'false'}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                                <SelectValue placeholder="Selecione o status" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                            <SelectItem value="true" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Ativo</SelectItem>
                                            <SelectItem value="false" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Inativo</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter>
                            <Button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                disabled={updateMutation.isPending}
                                className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                disabled={updateMutation.isPending}
                                className="font-semibold"
                                style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                            >
                                {updateMutation.isPending ? 'Salvando...' : 'Salvar Alteracoes'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export function SuppliersPage() {
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [supplierToDeactivate, setSupplierToDeactivate] = useState<Supplier | null>(null);

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const deactivateMutation = useDeactivateSupplier();

    const activateMutation = useMutation({
        mutationFn: (id: number) => suppliersService.activate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers-admin'] });
            toast({ title: 'Fornecedor ativado' });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao ativar fornecedor',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });

    const isActiveFilter = statusFilter === 'all' ? undefined : statusFilter === 'active';

    const { data, isLoading } = useSuppliersAdmin({
        search: search.trim() || undefined,
        is_active: isActiveFilter,
        page: 1,
        limit: 100,
    });

    const suppliers = data?.items ?? [];

    const filteredSuppliers = useMemo(() => {
        if (!search.trim()) return suppliers;
        const q = search.toLowerCase();
        return suppliers.filter(
            (s) =>
                s.company_name.toLowerCase().includes(q) ||
                (s.cnpj ?? '').toLowerCase().includes(q)
        );
    }, [suppliers, search]);

    const handleEditClick = useCallback((supplier: Supplier) => {
        setEditSupplier(supplier);
        setEditDialogOpen(true);
    }, []);

    const handleDeactivateClick = useCallback((supplier: Supplier) => {
        setSupplierToDeactivate(supplier);
    }, []);

    const handleConfirmDeactivate = useCallback(() => {
        if (!supplierToDeactivate) return;
        deactivateMutation.mutate(supplierToDeactivate.id, {
            onSuccess: () => setSupplierToDeactivate(null),
        });
    }, [deactivateMutation, supplierToDeactivate]);

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            <div className="space-y-3">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                            <Building2 className="w-5 h-5" style={{ color: '#F5A800' }} />
                        </div>
                        <div>
                            <h1
                                className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Gestão de Fornecedores
                            </h1>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">
                                Gerencie os fornecedores cadastrados no sistema
                            </p>
                        </div>
                    </div>
                    <Button
                        onClick={() => setCreateDialogOpen(true)}
                        className="font-semibold shrink-0"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Novo Fornecedor
                    </Button>
                </div>

                {/* Filtros */}
                <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Buscar</span>
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                            <Input
                                placeholder="Buscar por empresa ou CNPJ..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Status</span>
                        <Select
                            value={statusFilter}
                            onValueChange={(val) => setStatusFilter(val as typeof statusFilter)}
                        >
                            <SelectTrigger className="w-[160px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todos os status</SelectItem>
                                <SelectItem value="active" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Ativo</SelectItem>
                                <SelectItem value="inactive" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Inativo</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Contagem */}
            <p className="text-sm text-[#666666] dark:text-zinc-400">
                {filteredSuppliers.length} fornecedor(es) encontrado(s)
            </p>

            {/* Tabela */}
            <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-100 dark:bg-zinc-800/60">
                        <tr>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left">Empresa</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left hidden md:table-cell">CNPJ</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left hidden lg:table-cell">Responsavel</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left hidden lg:table-cell">Telefone</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left hidden xl:table-cell">E-mail</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left">Status</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-right">Acoes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <tr key={i} className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                    {Array.from({ length: 6 }).map((__, j) => (
                                        <td key={j} className="px-4 py-3">
                                            <Skeleton className="h-5 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse rounded" />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : filteredSuppliers.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="text-center py-12 text-[#999999] dark:text-zinc-500"
                                >
                                    Nenhum fornecedor encontrado com os filtros aplicados.
                                </td>
                            </tr>
                        ) : (
                            filteredSuppliers.map((supplier) => (
                                <tr
                                    key={supplier.id}
                                    className="border-t border-[#E8E8E8] dark:border-[#333333] hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                                >
                                    <td className="px-4 py-3 text-sm font-medium text-[#111111] dark:text-zinc-100">
                                        {supplier.company_name}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 hidden md:table-cell font-mono">
                                        {supplier.cnpj || '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 hidden lg:table-cell">
                                        {supplier.responsible || '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 hidden lg:table-cell">
                                        {supplier.phone || '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400 hidden xl:table-cell">
                                        {supplier.email || '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                        {supplier.is_active ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700/50">
                                                Ativo
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border border-[#D1D1D1] dark:border-zinc-700">
                                                Inativo
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="text-[#F5A800]">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                                                <DropdownMenuItem
                                                    onClick={() => handleEditClick(supplier)}
                                                    className="text-[#111111] dark:text-zinc-200 focus:bg-gray-100 dark:focus:bg-zinc-700"
                                                >
                                                    <Edit className="h-4 w-4 mr-2" />
                                                    Editar
                                                </DropdownMenuItem>
                                                {supplier.is_active ? (
                                                    <DropdownMenuItem
                                                        onClick={() => handleDeactivateClick(supplier)}
                                                        className="text-[#111111] dark:text-zinc-200 focus:bg-gray-100 dark:focus:bg-zinc-700"
                                                    >
                                                        <ToggleLeft className="h-4 w-4 mr-2" />
                                                        Desativar
                                                    </DropdownMenuItem>
                                                ) : (
                                                    <DropdownMenuItem
                                                        onClick={() => activateMutation.mutate(supplier.id)}
                                                        className="text-green-600 focus:text-green-600 focus:bg-gray-100 dark:focus:bg-zinc-700"
                                                    >
                                                        <ToggleRight className="h-4 w-4 mr-2" />
                                                        Ativar
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Dialog Criar */}
            <CreateSupplierDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

            {/* Dialog Editar */}
            <EditSupplierDialog
                supplier={editSupplier}
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
            />

            {/* AlertDialog Desativar */}
            <AlertDialog
                open={!!supplierToDeactivate}
                onOpenChange={(open) => { if (!open) setSupplierToDeactivate(null); }}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Desativar fornecedor?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            O fornecedor{' '}
                            <span className="font-semibold text-[#111111] dark:text-zinc-200">
                                {supplierToDeactivate?.company_name}
                            </span>{' '}
                            sera desativado e nao aparecera mais em listagens ativas.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={deactivateMutation.isPending}
                            className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                        >
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDeactivate}
                            disabled={deactivateMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deactivateMutation.isPending ? 'Desativando...' : 'Desativar'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
