import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import brandsService from '@/services/api/brands.service';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Store, Building2, Edit, Eye, MoreHorizontal, Plus, Trash2, Warehouse, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth.store';
import { storesService, type Store as StoreType, type UpdateStorePayload, type CreateStorePayload } from '@/services/api/stores.service';
import { SharedInventoryStoresSection } from '@/components/features/stores/SharedInventoryStoresSection';
import { getApiErrorMessage } from '@/lib/api-error';

const createStoreSchema = z.object({
    name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
    code: z
        .string()
        .regex(/^LJ\d{2}$/, 'Código deve ser no formato LJ01 a LJ99'),
    brand_id: z.number({ error: 'Selecione uma marca' }).int().positive('Selecione uma marca'),
    phone: z.string().optional(),
    address: z.string().optional(),
});

type CreateStoreFormValues = z.infer<typeof createStoreSchema>;

interface CreateStoreDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nextCode: string;
}

function CreateStoreDialog({ open, onOpenChange, nextCode }: CreateStoreDialogProps) {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: brandsData } = useQuery({
        queryKey: ['brands', 'active'],
        queryFn: () => brandsService.list({ is_active: true }),
        staleTime: 1000 * 60 * 10,
    });

    const brands = brandsData?.items ?? [];

    const form = useForm<CreateStoreFormValues>({
        resolver: zodResolver(createStoreSchema),
        defaultValues: {
            name: '',
            code: nextCode,
            brand_id: undefined,
            phone: '',
            address: '',
        },
    });

    const createMutation = useMutation({
        mutationFn: (data: CreateStorePayload) => storesService.create(data),
        onSuccess: (newStore) => {
            queryClient.invalidateQueries({ queryKey: ['stores'] });
            toast({ title: `Loja ${newStore.code} criada com sucesso.` });
            onOpenChange(false);
            form.reset();
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao criar loja',
                description: getApiErrorMessage(error, 'Verifique os dados e tente novamente.'),
            });
        },
    });

    const onSubmit = useCallback(
        (data: CreateStoreFormValues) => {
            createMutation.mutate({
                name: data.name,
                code: data.code,
                brand_id: data.brand_id,
                phone: data.phone || null,
                address: data.address || null,
            });
        },
        [createMutation]
    );

    return (
        <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) form.reset({ name: '', code: nextCode, brand_id: undefined, phone: '', address: '' }); }}>
            <DialogContent className="sm:max-w-[480px] bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                <DialogHeader>
                    <DialogTitle className="text-[#111111] dark:text-white">Nova Loja</DialogTitle>
                    <DialogDescription className="text-[#666666] dark:text-zinc-400">
                        Cadastre uma nova unidade para a rede AEMS.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Nome da Loja *</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Ex: AEMS Toyota - Centro"
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
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Código</FormLabel>
                                    <FormControl>
                                        <Input
                                            readOnly
                                            className="uppercase font-mono bg-gray-50 dark:bg-zinc-800/50 border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white cursor-not-allowed opacity-70 focus-visible:ring-0 focus-visible:ring-offset-0"
                                            {...field}
                                        />
                                    </FormControl>
                                    <p className="text-xs text-[#999999] dark:text-zinc-500">Gerado automaticamente — não pode ser alterado.</p>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="brand_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Marca da Concessionária *</FormLabel>
                                    <Select
                                        onValueChange={(val) => field.onChange(Number(val))}
                                        value={field.value ? String(field.value) : ''}
                                    >
                                        <FormControl>
                                            <SelectTrigger className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                                <SelectValue placeholder="Selecione a marca" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                            {brands.map((b) => (
                                                <SelectItem key={b.id} value={String(b.id)} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                                    {b.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Telefone</FormLabel>
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
                            name="address"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Endereço</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Rua, número, bairro"
                                            className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
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
                                {createMutation.isPending ? 'Criando...' : 'Criar Loja'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

const editStoreSchema = z.object({
    name: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres'),
    is_active: z.boolean(),
    is_galpon_store: z.boolean(),
    address: z.string().optional(),
    phone: z.string().optional(),
});

type EditStoreFormValues = z.infer<typeof editStoreSchema>;

interface EditStoreDialogProps {
    store: StoreType | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isOwner: boolean;
}

function EditStoreDialog({ store, open, onOpenChange, isOwner }: EditStoreDialogProps) {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const [hasSharedInventory, setHasSharedInventory] = useState<boolean>(false);
    const [linkedInventoryStoreIds, setLinkedInventoryStoreIds] = useState<number[]>([]);

    // Sync state when the store prop changes (dialog opens for a different store)
    const prevStoreIdRef = useState<number | null>(null);
    if (store && store.id !== prevStoreIdRef[0]) {
        prevStoreIdRef[1](store.id);
        setHasSharedInventory(store.has_shared_inventory ?? false);
        setLinkedInventoryStoreIds(store.linked_inventory_store_ids ?? []);
    }

    const form = useForm<EditStoreFormValues>({
        resolver: zodResolver(editStoreSchema),
        values: store
            ? {
                  name: store.name,
                  is_active: store.is_active,
                  is_galpon_store: store.is_galpon_store ?? false,
                  address: store.address ?? '',
                  phone: store.phone ?? '',
              }
            : undefined,
    });

    const updateMutation = useMutation({
        mutationFn: (data: UpdateStorePayload) => storesService.update(store!.id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stores'] });
            toast({ title: 'Loja atualizada com sucesso.' });
            onOpenChange(false);
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Não foi possível atualizar',
                description: getApiErrorMessage(error, 'Verifique os dados e tente novamente.'),
            });
        },
    });

    const onSubmit = useCallback(
        (data: EditStoreFormValues) => {
            updateMutation.mutate({
                name: data.name,
                is_active: data.is_active,
                is_galpon_store: data.is_galpon_store,
                address: data.address,
                phone: data.phone,
                has_shared_inventory: hasSharedInventory,
                linked_inventory_store_ids: hasSharedInventory ? linkedInventoryStoreIds : [],
            });
        },
        [updateMutation, hasSharedInventory, linkedInventoryStoreIds]
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px] max-h-[90vh] flex flex-col bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="text-[#111111] dark:text-white">Editar Loja</DialogTitle>
                    <DialogDescription className="text-[#666666] dark:text-zinc-400">
                        Atualize os dados de{' '}
                        <span className="font-semibold text-[#111111] dark:text-zinc-200">{store?.code}</span> —{' '}
                        {store?.name}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
                        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Nome da Loja</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Ex: AEMS Toyota - Centro"
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

                        <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Telefone</FormLabel>
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
                            name="address"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[#666666] dark:text-zinc-300">Endereço</FormLabel>
                                    <FormControl>
                                        <Input
                                            placeholder="Rua, número, bairro"
                                            className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {isOwner && (
                            <FormField
                                control={form.control}
                                name="is_galpon_store"
                                render={({ field }) => (
                                    <FormItem>
                                        <div className="flex items-center justify-between rounded-lg border border-[#D1D1D1] dark:border-[#333333] p-3 gap-4">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <Warehouse className="h-4 w-4 shrink-0 text-[#F5A800]" />
                                                <div className="min-w-0">
                                                    <FormLabel className="text-sm font-medium text-[#111111] dark:text-white cursor-pointer">
                                                        Loja do Galpão
                                                    </FormLabel>
                                                    <p className="text-xs text-[#666666] dark:text-zinc-400 mt-0.5 leading-tight">
                                                        Marque se esta loja controla o estoque de bobinas para instalações em galpão. Apenas uma loja deve ter esta opção ativa.
                                                    </p>
                                                </div>
                                            </div>
                                            <FormControl>
                                                <Switch
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                    className="shrink-0 data-[state=checked]:bg-[#F5A800]"
                                                />
                                            </FormControl>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {isOwner && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between rounded-lg border border-[#D1D1D1] dark:border-[#333333] p-3 gap-4">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <Share2 className="h-4 w-4 shrink-0 text-[#F5A800]" />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-[#111111] dark:text-white">
                                                Estoque Compartilhado
                                            </p>
                                            <p className="text-xs text-[#666666] dark:text-zinc-400 mt-0.5 leading-tight">
                                                Compartilha bobinas de película com outras lojas
                                            </p>
                                        </div>
                                    </div>
                                    <Switch
                                        checked={hasSharedInventory}
                                        onCheckedChange={(v) => {
                                            setHasSharedInventory(v);
                                            if (!v) setLinkedInventoryStoreIds([]);
                                        }}
                                        className="shrink-0 data-[state=checked]:bg-[#F5A800]"
                                    />
                                </div>
                                {hasSharedInventory && store && (
                                    <SharedInventoryStoresSection
                                        storeIds={linkedInventoryStoreIds}
                                        currentStoreId={store.id}
                                        onChange={setLinkedInventoryStoreIds}
                                    />
                                )}
                            </div>
                        )}
                        </div>

                        <DialogFooter className="shrink-0 pt-4 border-t border-[#D1D1D1] dark:border-[#333333] mt-4">
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
                                {updateMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

export function StoreManagementPage() {
    const hasPermission = useAuthStore((s) => s.hasPermission);
    const isOwner = useAuthStore((s) => s.isOwner);
    const canEdit = hasPermission('stores', 'edit');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [editStore, setEditStore] = useState<StoreType | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [storeToDelete, setStoreToDelete] = useState<StoreType | null>(null);

    const queryClient = useQueryClient();
    const { toast } = useToast();

    const deleteMutation = useMutation({
        mutationFn: (id: number) => storesService.delete(id),
        onSuccess: (deleted) => {
            queryClient.setQueryData<StoreType[]>(['stores'], (old) =>
                old ? old.filter((s) => s.id !== deleted.id) : []
            );
            toast({ title: `Loja ${deleted.code} excluída com sucesso.` });
            setStoreToDelete(null);
        },
        onError: () => {
            toast({
                variant: 'destructive',
                title: 'Erro ao excluir loja',
                description: 'Verifique se a loja não possui vínculos ativos e tente novamente.',
            });
        },
    });

    const toggleStatusMutation = useMutation({
        mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
            storesService.update(id, { is_active }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stores'] });
            toast({ title: 'Status da loja atualizado com sucesso.' });
        },
        onError: () => {
            toast({
                variant: 'destructive',
                title: 'Erro ao atualizar status da loja',
            });
        },
    });

    const { data: stores = [], isLoading } = useQuery({
        queryKey: ['stores'],
        queryFn: () => storesService.list(),
        staleTime: 1000 * 60 * 60,
    });

    const filteredStores = useMemo(() => {
        return stores
            .filter((store) => {
                const matchesSearch =
                    search.trim() === '' ||
                    store.name.toLowerCase().includes(search.toLowerCase()) ||
                    store.code.toLowerCase().includes(search.toLowerCase());

                const matchesStatus =
                    statusFilter === 'all' ||
                    (statusFilter === 'active' && store.is_active) ||
                    (statusFilter === 'inactive' && !store.is_active);

                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => {
                const brandA = (a.brand?.name ?? a.dealership_brand ?? '').toLowerCase();
                const brandB = (b.brand?.name ?? b.dealership_brand ?? '').toLowerCase();
                return brandA.localeCompare(brandB, 'pt-BR');
            });
    }, [stores, search, statusFilter]);

    const nextStoreCode = useMemo(() => {
        const codes = stores
            .map((s) => s.code.match(/^LJ(\d{2})$/)?.at(1))
            .filter(Boolean)
            .map(Number);
        const max = codes.length > 0 ? Math.max(...codes) : 0;
        return `LJ${String(max + 1).padStart(2, '0')}`;
    }, [stores]);

    const handleEditClick = useCallback((store: StoreType) => {
        setEditStore(store);
        setEditDialogOpen(true);
    }, []);

    const handleDeleteClick = useCallback((store: StoreType) => {
        setStoreToDelete(store);
    }, []);

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
                                Gestão de Lojas
                            </h1>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">
                                Visualize e edite as configurações das{' '}
                                <span className="font-medium text-[#333333] dark:text-zinc-300">{stores.length} lojas</span> da rede
                            </p>
                        </div>
                    </div>
                    {canEdit && (
                        <Button
                            onClick={() => setCreateDialogOpen(true)}
                            className="font-semibold shrink-0"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Nova Loja
                        </Button>
                    )}
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Buscar</span>
                        <div className="relative flex-1 max-w-sm">
                            <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                            <Input
                                placeholder="Buscar por nome ou código..."
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
                            <SelectTrigger className="w-[150px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
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

            {/* Results count */}
            <p className="text-sm text-[#666666] dark:text-zinc-400">
                {filteredStores.length} loja(s) encontrada(s)
            </p>

            {/* Table */}
            <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-100 dark:bg-zinc-800/60">
                        <tr>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left w-24">Marca</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left">Nome</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left">Telefone</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left">Endereço</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-left">Status</th>
                            <th className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            Array.from({ length: 6 }).map((_, i) => (
                                <tr key={i} className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                    {Array.from({ length: 5 }).map((__, j) => (
                                        <td key={j} className="px-4 py-3">
                                            <Skeleton className="h-5 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse rounded" />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : filteredStores.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={6}
                                    className="text-center py-12 text-[#999999] dark:text-zinc-500"
                                >
                                    Nenhuma loja encontrada com os filtros aplicados.
                                </td>
                            </tr>
                        ) : (
                            filteredStores.map((store) => (
                                <tr key={store.id} className="border-t border-[#E8E8E8] dark:border-[#333333] hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                                    <td className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200">
                                        <span className="font-mono font-semibold text-sm text-[#111111] dark:text-zinc-100">
                                            {store.brand?.name ?? store.dealership_brand ?? '—'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200 font-medium">{store.name}</td>
                                    <td className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400">
                                        {store.phone || '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#666666] dark:text-zinc-400">
                                        {store.address || '—'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200">
                                        {store.is_active ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700/50">
                                                Ativo
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border border-[#D1D1D1] dark:border-zinc-700">
                                                Inativo
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200">
                                        <div className="flex items-center justify-end">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" aria-label="Ações" className="text-[#F5A800]">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEditClick(store)}>
                                                        <Edit className="h-4 w-4 mr-2" />
                                                        Editar
                                                    </DropdownMenuItem>
                                                    {store.is_active ? (
                                                        <DropdownMenuItem onClick={() => toggleStatusMutation.mutate({ id: store.id, is_active: false })} className="ring-1 ring-[#F5A800] ring-inset rounded-sm">
                                                            <Eye className="h-4 w-4 mr-2" />
                                                            Desativar
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem onClick={() => toggleStatusMutation.mutate({ id: store.id, is_active: true })}>
                                                            <Eye className="h-4 w-4 mr-2 text-green-600" />
                                                            <span className="text-green-600">Ativar</span>
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem onClick={() => handleDeleteClick(store)} className="text-red-600 focus:text-red-600">
                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                        Excluir
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Edit Dialog */}
            <EditStoreDialog
                store={editStore}
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                isOwner={isOwner()}
            />

            {/* Create Dialog */}
            <CreateStoreDialog
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                nextCode={nextStoreCode}
            />

            {/* Delete Confirmation Dialog */}
            <AlertDialog
                open={!!storeToDelete}
                onOpenChange={(open) => { if (!open) setStoreToDelete(null); }}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Excluir loja?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            A loja{' '}
                            <span className="font-semibold text-[#111111] dark:text-zinc-200">
                                {storeToDelete?.code} — {storeToDelete?.name}
                            </span>{' '}
                            será excluída permanentemente. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={deleteMutation.isPending}
                            className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                        >
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => storeToDelete && deleteMutation.mutate(storeToDelete.id)}
                            disabled={deleteMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
