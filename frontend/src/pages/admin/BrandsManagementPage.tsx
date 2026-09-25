import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Tag, MoreHorizontal, Edit, Eye, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
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
import brandsService from '@/services/api/brands.service';
import type { BrandItem } from '@/services/api/brands.service';
import { useToast } from '@/hooks/use-toast';
import { useHasPermission } from '@/hooks/useMyPermissions';

interface CreateForm {
    name: string;
    code: string;
}

interface EditForm {
    name: string;
    is_active: boolean;
}

const INITIAL_CREATE_FORM: CreateForm = { name: '', code: '' };
const INITIAL_EDIT_FORM: EditForm = { name: '', is_active: true };

export function BrandsManagementPage() {
    const hasPermission = useHasPermission();
    const canEdit = hasPermission('brands', 'edit');
    const canDelete = hasPermission('brands', 'delete');
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editingBrand, setEditingBrand] = useState<BrandItem | null>(null);
    const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [createForm, setCreateForm] = useState<CreateForm>(INITIAL_CREATE_FORM);
    const [editForm, setEditForm] = useState<EditForm>(INITIAL_EDIT_FORM);

    const { data: brandsData, isLoading } = useQuery({
        queryKey: ['brands'],
        queryFn: () => brandsService.list(),
        staleTime: 1000 * 60 * 2,
    });

    const brands = brandsData?.items ?? [];

    const createMutation = useMutation({
        mutationFn: () =>
            brandsService.create({
                name: createForm.name.trim(),
                code: createForm.code.trim().toLowerCase(),
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            setAddDialogOpen(false);
            setCreateForm(INITIAL_CREATE_FORM);
            toast({ title: 'Marca criada com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao criar marca.' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: () => {
            if (!editingBrand) throw new Error('Nenhuma marca selecionada');
            return brandsService.update(editingBrand.id, {
                name: editForm.name.trim(),
                is_active: editForm.is_active,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            setEditingBrand(null);
            setEditForm(INITIAL_EDIT_FORM);
            toast({ title: 'Marca atualizada com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao atualizar marca.' });
        },
    });

    const deactivateMutation = useMutation({
        mutationFn: (id: number) => brandsService.deactivate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            setConfirmDeactivateId(null);
            toast({ title: 'Marca desativada com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao desativar marca.' });
        },
    });

    const reactivateMutation = useMutation({
        mutationFn: (id: number) => brandsService.update(id, { is_active: true }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            toast({ title: 'Marca reativada com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao reativar marca.' });
        },
    });

    const hardDeleteMutation = useMutation({
        mutationFn: (id: number) => brandsService.hardDelete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            setConfirmDeleteId(null);
            toast({ title: 'Marca excluída permanentemente.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Não foi possível excluir. Verifique se há vínculos ativos.' });
        },
    });

    const handleEdit = (brand: BrandItem) => {
        setEditingBrand(brand);
        setEditForm({ name: brand.name, is_active: brand.is_active });
    };

    const handleCreate = () => {
        if (!createForm.name.trim()) {
            toast({ variant: 'destructive', title: 'Nome é obrigatório.' });
            return;
        }
        if (!createForm.code.trim()) {
            toast({ variant: 'destructive', title: 'Código é obrigatório.' });
            return;
        }
        createMutation.mutate();
    };

    const handleUpdate = () => {
        if (!editForm.name.trim()) {
            toast({ variant: 'destructive', title: 'Nome é obrigatório.' });
            return;
        }
        updateMutation.mutate();
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Cabeçalho */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <Tag className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Marcas
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Marcas de veículos disponíveis para os modelos e ordens de serviço.
                        </p>
                    </div>
                </div>
                {canEdit && (
                    <Button
                        onClick={() => {
                            setCreateForm(INITIAL_CREATE_FORM);
                            setAddDialogOpen(true);
                        }}
                        className="font-semibold shrink-0"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Nova Marca
                    </Button>
                )}
            </div>

            {/* Conteúdo */}
            {isLoading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="h-6 w-6 animate-spin text-[#999999] dark:text-zinc-400" />
                </div>
            ) : brands.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <Tag className="h-10 w-10 text-[#999999]/40 dark:text-zinc-400/40" />
                    <p className="text-sm text-[#666666] dark:text-zinc-500">Nenhuma marca cadastrada.</p>
                </div>
            ) : (
                <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                    {/* Cabeçalho da tabela */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-2 bg-gray-50 dark:bg-zinc-800/60 border-b border-[#D1D1D1] dark:border-[#333333]">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400">Nome</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-24 text-center">Código</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-20 text-center">Status</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-12 text-center">Ações</span>
                    </div>

                    <div className="divide-y divide-[#E8E8E8] dark:divide-[#333333]">
                        {brands.map((brand) => (
                            <div
                                key={brand.id}
                                className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                            >
                                <span className="text-sm font-medium text-[#111111] dark:text-zinc-200 truncate">
                                    {brand.name}
                                </span>

                                <span className="w-24 text-center font-mono text-xs text-[#666666] dark:text-zinc-400 bg-gray-100 dark:bg-zinc-800 rounded px-2 py-0.5">
                                    {brand.code}
                                </span>

                                <div className="w-20 flex justify-center">
                                    {brand.is_active ? (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700/50">
                                            Ativo
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border border-[#D1D1D1] dark:border-zinc-700">
                                            Inativo
                                        </span>
                                    )}
                                </div>

                                <div className="w-12 flex items-center justify-center">
                                    {(canEdit || canDelete) && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" aria-label="Ações" className="text-[#F5A800]">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {canEdit && (
                                                <DropdownMenuItem onClick={() => handleEdit(brand)}>
                                                    <Edit className="h-4 w-4 mr-2" />
                                                    Editar
                                                </DropdownMenuItem>
                                            )}
                                            {canEdit && (brand.is_active ? (
                                                <DropdownMenuItem onClick={() => setConfirmDeactivateId(brand.id)} className="ring-1 ring-[#F5A800] ring-inset rounded-sm">
                                                    <Eye className="h-4 w-4 mr-2" />
                                                    Desativar
                                                </DropdownMenuItem>
                                            ) : (
                                                <DropdownMenuItem onClick={() => reactivateMutation.mutate(brand.id)}>
                                                    <Eye className="h-4 w-4 mr-2 text-green-600" />
                                                    <span className="text-green-600">Ativar</span>
                                                </DropdownMenuItem>
                                            ))}
                                            {canDelete && (
                                                <DropdownMenuItem onClick={() => setConfirmDeleteId(brand.id)} className="text-red-600 focus:text-red-600">
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Excluir
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Dialog: Nova Marca */}
            <Dialog
                open={addDialogOpen}
                onOpenChange={(open) => {
                    setAddDialogOpen(open);
                    if (!open) setCreateForm(INITIAL_CREATE_FORM);
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Nova Marca</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="brand-name" className="text-[#666666] dark:text-zinc-300">
                                Nome *
                            </Label>
                            <Input
                                id="brand-name"
                                placeholder="Ex: Toyota"
                                value={createForm.name}
                                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="brand-code" className="text-[#666666] dark:text-zinc-300">
                                Código *
                            </Label>
                            <Input
                                id="brand-code"
                                placeholder="Ex: toyota"
                                value={createForm.code}
                                onChange={(e) =>
                                    setCreateForm({ ...createForm, code: e.target.value.toLowerCase() })
                                }
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800] font-mono"
                            />
                            <p className="text-xs text-[#999999] dark:text-zinc-500">
                                Identificador único em minúsculas, sem espaços (ex: toyota, byd, fiat).
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setAddDialogOpen(false);
                                setCreateForm(INITIAL_CREATE_FORM);
                            }}
                            className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleCreate}
                            disabled={createMutation.isPending}
                            className="font-semibold"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            {createMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Criar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog: Editar Marca */}
            <Dialog
                open={editingBrand !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditingBrand(null);
                        setEditForm(INITIAL_EDIT_FORM);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Editar Marca</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-brand-name" className="text-[#666666] dark:text-zinc-300">
                                Nome *
                            </Label>
                            <Input
                                id="edit-brand-name"
                                placeholder="Ex: Toyota"
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-[#D1D1D1] dark:border-[#333333] px-4 py-3">
                            <div>
                                <p className="text-sm font-medium text-[#111111] dark:text-zinc-200">Marca ativa</p>
                                <p className="text-xs text-[#666666] dark:text-zinc-400">
                                    Marcas inativas não aparecem na criação de O.S.
                                </p>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={editForm.is_active}
                                onClick={() => setEditForm({ ...editForm, is_active: !editForm.is_active })}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A800] focus-visible:ring-offset-2 ${
                                    editForm.is_active
                                        ? 'bg-[#F5A800]'
                                        : 'bg-gray-200 dark:bg-zinc-700'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                                        editForm.is_active ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setEditingBrand(null);
                                setEditForm(INITIAL_EDIT_FORM);
                            }}
                            className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleUpdate}
                            disabled={updateMutation.isPending}
                            className="font-semibold"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            {updateMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* AlertDialog: Confirmar Desativação */}
            <AlertDialog
                open={confirmDeactivateId !== null}
                onOpenChange={(open) => !open && setConfirmDeactivateId(null)}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Desativar Marca</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Tem certeza que deseja desativar{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {brands.find((b) => b.id === confirmDeactivateId)?.name ?? 'esta marca'}
                            </span>
                            ? Ela não aparecerá mais na criação de ordens de serviço.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() =>
                                confirmDeactivateId !== null &&
                                deactivateMutation.mutate(confirmDeactivateId)
                            }
                            disabled={deactivateMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deactivateMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Desativar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* AlertDialog: Confirmar Exclusão Permanente */}
            <AlertDialog
                open={confirmDeleteId !== null}
                onOpenChange={(open) => !open && setConfirmDeleteId(null)}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Excluir Marca Permanentemente</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Esta ação é <span className="font-semibold text-red-600">irreversível</span>. A marca{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {brands.find((b) => b.id === confirmDeleteId)?.name ?? ''}
                            </span>{' '}
                            será excluída permanentemente. Só é possível excluir marcas sem lojas, modelos ou serviços vinculados.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => confirmDeleteId !== null && hardDeleteMutation.mutate(confirmDeleteId)}
                            disabled={hardDeleteMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {hardDeleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Excluir Permanentemente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
