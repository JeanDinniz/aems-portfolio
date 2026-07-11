import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Car, MoreHorizontal, Edit, Eye, Trash2, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
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
import { vehicleModelsService } from '@/services/api/vehicle-models.service';
import type { VehicleModelItem } from '@/services/api/vehicle-models.service';
import brandsService from '@/services/api/brands.service';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth.store';

interface ModelForm {
    name: string;
    brand_id: string;
}

const INITIAL_FORM: ModelForm = { name: '', brand_id: '' };

export function VehicleModelsPage() {
    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canEdit = hasPermission('models', 'edit');
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [activeBrandId, setActiveBrandId] = useState<number | null>(null);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editingModel, setEditingModel] = useState<VehicleModelItem | null>(null);
    const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null);
    const [confirmHardDeleteId, setConfirmHardDeleteId] = useState<number | null>(null);
    const [form, setForm] = useState<ModelForm>(INITIAL_FORM);

    const { data: brandsData, isLoading: brandsLoading } = useQuery({
        queryKey: ['brands', 'management'],
        queryFn: () => brandsService.list(),
        staleTime: 1000 * 60 * 5,
    });

    const brands = brandsData?.items ?? [];

    const { data: models, isLoading: modelsLoading } = useQuery({
        queryKey: ['vehicle-models', 'management', activeBrandId, brands.map((b) => b.id)],
        queryFn: async () => {
            if (activeBrandId !== null) {
                return vehicleModelsService.list({ brand_id: activeBrandId, active_only: false });
            }
            // "Todos": busca modelos de cada marca em paralelo e combina
            const results = await Promise.all(
                brands.map((b) => vehicleModelsService.list({ brand_id: b.id, active_only: false }))
            );
            return results.flat();
        },
        enabled: brands.length > 0,
        staleTime: 1000 * 60 * 2,
    });

    const createMutation = useMutation({
        mutationFn: () => {
            const brandId = Number(form.brand_id);
            if (!brandId) throw new Error('Nenhuma marca selecionada');
            return vehicleModelsService.create(brandId, { name: form.name.trim() });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicle-models'] });
            setAddDialogOpen(false);
            setForm(INITIAL_FORM);
            toast({ title: 'Modelo adicionado com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao adicionar modelo.' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: () => {
            if (!editingModel) throw new Error('Dados inválidos');
            return vehicleModelsService.update(editingModel.id, editingModel.brand_id, {
                name: form.name.trim(),
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicle-models'] });
            setEditingModel(null);
            setForm(INITIAL_FORM);
            toast({ title: 'Modelo atualizado com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao atualizar modelo.' });
        },
    });

    const deactivateMutation = useMutation({
        mutationFn: (id: number) => {
            const model = models?.find((m) => m.id === id);
            if (!model) throw new Error('Modelo não encontrado');
            return vehicleModelsService.deactivate(id, model.brand_id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicle-models'] });
            setConfirmDeactivateId(null);
            toast({ title: 'Modelo desativado com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao desativar modelo.' });
        },
    });

    const reactivateMutation = useMutation({
        mutationFn: (id: number) => {
            const model = models?.find((m) => m.id === id);
            if (!model) throw new Error('Modelo não encontrado');
            return vehicleModelsService.update(id, model.brand_id, { is_active: true });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicle-models'] });
            toast({ title: 'Modelo reativado com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao reativar modelo.' });
        },
    });

    const hardDeleteMutation = useMutation({
        mutationFn: (id: number) => {
            const model = models?.find((m) => m.id === id);
            if (!model) throw new Error('Modelo não encontrado');
            return vehicleModelsService.hardDelete(id, model.brand_id);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['vehicle-models'] });
            setConfirmHardDeleteId(null);
            toast({ title: 'Modelo excluído permanentemente.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Não foi possível excluir. Verifique se há O.S. vinculadas.' });
        },
    });

    const handleEdit = (model: VehicleModelItem) => {
        setEditingModel(model);
        setForm({ name: model.name, brand_id: String(model.brand_id) });
    };

    const handleCreate = () => {
        if (!form.name.trim()) {
            toast({ variant: 'destructive', title: 'Nome é obrigatório.' });
            return;
        }
        if (!form.brand_id) {
            toast({ variant: 'destructive', title: 'Marca é obrigatória.' });
            return;
        }
        createMutation.mutate();
    };

    const handleUpdate = () => {
        if (!form.name.trim()) {
            toast({ variant: 'destructive', title: 'Nome é obrigatório.' });
            return;
        }
        updateMutation.mutate();
    };

    const isLoading = brandsLoading || modelsLoading;

    const handleExport = () => {
        if (!models || models.length === 0) return;
        const rows = models.map((m) => ({
            'Nome do Modelo': m.name,
            'Marca': m.brand?.name ?? '',
            'Status': m.is_active ? 'Ativo' : 'Inativo',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Modelos');
        XLSX.writeFile(wb, 'modelos_veiculos.xlsx');
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            <div className="space-y-3">
                {/* Cabeçalho */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                            <Car className="w-5 h-5" style={{ color: '#F5A800' }} />
                        </div>
                        <div>
                            <h1
                                className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Modelos de Veículos
                            </h1>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">
                                Modelos disponíveis por marca para seleção nas ordens de serviço.
                            </p>
                        </div>
                    </div>
                    {canEdit && (
                        <div className="flex gap-2 shrink-0">
                            <button
                                onClick={handleExport}
                                disabled={!models || models.length === 0}
                                className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download className="h-4 w-4" />
                                Exportar
                            </button>
                            <Button
                                onClick={() => {
                                    setForm(INITIAL_FORM);
                                    setAddDialogOpen(true);
                                }}
                                className="font-semibold"
                                style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Novo Modelo
                            </Button>
                        </div>
                    )}
                </div>

                {!brandsLoading && brands.length > 0 && (
                    /* Filtro de Marca */
                    <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Marca</span>
                            <Select
                                value={activeBrandId !== null ? String(activeBrandId) : 'all'}
                                onValueChange={(v) => setActiveBrandId(v === 'all' ? null : Number(v))}
                            >
                                <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                    <SelectValue placeholder="Marca" />
                                </SelectTrigger>
                                <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                    <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                        Todos
                                    </SelectItem>
                                    {brands.map((brand) => (
                                        <SelectItem
                                            key={brand.id}
                                            value={String(brand.id)}
                                            className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white"
                                        >
                                            {brand.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}
            </div>

            {!brandsLoading && brands.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <Car className="h-10 w-10 text-[#999999]/40 dark:text-zinc-400/40" />
                    <p className="text-sm text-[#666666] dark:text-zinc-500">Nenhuma marca cadastrada. Cadastre marcas primeiro.</p>
                </div>
            ) : (
                <>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-6 w-6 animate-spin text-[#999999] dark:text-zinc-400" />
                        </div>
                    ) : !models?.length ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-2">
                            <Car className="h-10 w-10 text-[#999999]/40 dark:text-zinc-400/40" />
                            <p className="text-sm text-[#666666] dark:text-zinc-500">
                                Nenhum modelo encontrado para os filtros selecionados.
                            </p>
                        </div>
                    ) : (
                        <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                            {/* Header da tabela */}
                            <div className="grid grid-cols-[2fr_1fr_auto_auto] gap-x-4 px-4 py-2.5 bg-gray-100 dark:bg-zinc-800/60 border-b border-[#D1D1D1] dark:border-[#333333]">
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Nome do Modelo</span>
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Marca</span>
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Status</span>
                                <span className="w-24" />
                            </div>
                            <div className="divide-y divide-[#E8E8E8] dark:divide-[#333333]">
                                {models.map((model) => (
                                    <div
                                        key={model.id}
                                        className="grid grid-cols-[2fr_1fr_auto_auto] gap-x-4 items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                                    >
                                        <span className="text-sm font-medium text-[#111111] dark:text-zinc-200">{model.name}</span>
                                        <span className="text-sm text-[#666666] dark:text-zinc-400">
                                            {model.brand?.name ?? brands.find((b) => b.id === model.brand_id)?.name ?? '—'}
                                        </span>
                                        <div>
                                            {model.is_active ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700/50">
                                                    Ativo
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border border-[#D1D1D1] dark:border-zinc-700">
                                                    Inativo
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-end shrink-0">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" aria-label="Ações" className="text-[#F5A800]">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEdit(model)}>
                                                        <Edit className="h-4 w-4 mr-2" />
                                                        Editar
                                                    </DropdownMenuItem>
                                                    {model.is_active ? (
                                                        <DropdownMenuItem onClick={() => setConfirmDeactivateId(model.id)} className="ring-1 ring-[#F5A800] ring-inset rounded-sm">
                                                            <Eye className="h-4 w-4 mr-2" />
                                                            Desativar
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem onClick={() => reactivateMutation.mutate(model.id)}>
                                                            <Eye className="h-4 w-4 mr-2 text-green-600" />
                                                            <span className="text-green-600">Ativar</span>
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem onClick={() => setConfirmHardDeleteId(model.id)} className="text-red-600 focus:text-red-600">
                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                        Excluir
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Dialog: Adicionar Modelo */}
            <Dialog
                open={addDialogOpen}
                onOpenChange={(open) => {
                    setAddDialogOpen(open);
                    if (!open) setForm(INITIAL_FORM);
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Novo Modelo</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-[#666666] dark:text-zinc-300">Marca *</Label>
                            <Select
                                value={form.brand_id}
                                onValueChange={(v) => setForm({ ...form, brand_id: v })}
                            >
                                <SelectTrigger className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                    <SelectValue placeholder="Selecione a marca" />
                                </SelectTrigger>
                                <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                    {brands.map((b) => (
                                        <SelectItem key={b.id} value={String(b.id)} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                            {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="model-name" className="text-[#666666] dark:text-zinc-300">Nome do Modelo *</Label>
                            <Input
                                id="model-name"
                                placeholder="Ex: Corolla"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setAddDialogOpen(false);
                                setForm(INITIAL_FORM);
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
                            Adicionar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog: Editar Modelo */}
            <Dialog
                open={editingModel !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditingModel(null);
                        setForm(INITIAL_FORM);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Editar Modelo</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-model-name" className="text-[#666666] dark:text-zinc-300">Nome do Modelo *</Label>
                            <Input
                                id="edit-model-name"
                                placeholder="Ex: Corolla"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setEditingModel(null);
                                setForm(INITIAL_FORM);
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
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Desativar Modelo</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Tem certeza que deseja desativar{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {models?.find((m) => m.id === confirmDeactivateId)?.name ?? 'este modelo'}
                            </span>
                            ? Ele não aparecerá mais na criação de ordens de serviço.
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
                open={confirmHardDeleteId !== null}
                onOpenChange={(open) => !open && setConfirmHardDeleteId(null)}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Excluir Modelo Permanentemente</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Esta ação é <span className="font-semibold text-red-600">irreversível</span>. O modelo{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {models?.find((m) => m.id === confirmHardDeleteId)?.name ?? ''}
                            </span>{' '}
                            será excluído permanentemente. Só é possível excluir modelos sem ordens de serviço vinculadas.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => confirmHardDeleteId !== null && hardDeleteMutation.mutate(confirmHardDeleteId)}
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
