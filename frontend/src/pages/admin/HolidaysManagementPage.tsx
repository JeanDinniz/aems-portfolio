import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, CalendarOff, MoreHorizontal, Edit, Trash2 } from 'lucide-react';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useHasPermission } from '@/hooks/useMyPermissions';
import { useStores } from '@/hooks/useStores';
import holidaysService from '@/services/api/holidays.service';
import type { Holiday, CreateHolidayPayload, UpdateHolidayPayload } from '@/types/holiday.types';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 2 + i);

function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

interface HolidayFormState {
    date: string;
    name: string;
    store_id: string; // '' = todas as lojas (null)
}

const INITIAL_FORM: HolidayFormState = {
    date: '',
    name: '',
    store_id: '',
};

export function HolidaysManagementPage() {
    const hasPermission = useHasPermission();
    const canEdit = hasPermission('stores', 'edit');
    const canDelete = hasPermission('stores', 'delete');
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { allStores } = useStores();

    const [yearFilter, setYearFilter] = useState<number>(CURRENT_YEAR);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [createForm, setCreateForm] = useState<HolidayFormState>(INITIAL_FORM);
    const [editForm, setEditForm] = useState<HolidayFormState>(INITIAL_FORM);

    const { data: holidaysData, isLoading } = useQuery({
        queryKey: ['holidays', yearFilter],
        queryFn: () => holidaysService.list({ year: yearFilter, limit: 100 }),
        staleTime: 1000 * 60 * 2,
    });

    const holidays = holidaysData?.items ?? [];

    // Sort by date ascending
    const sortedHolidays = [...holidays].sort((a, b) => a.date.localeCompare(b.date));

    const createMutation = useMutation({
        mutationFn: (payload: CreateHolidayPayload) => holidaysService.create(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
            setAddDialogOpen(false);
            setCreateForm(INITIAL_FORM);
            toast({ title: 'Feriado criado com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao criar feriado.' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateHolidayPayload }) =>
            holidaysService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
            setEditingHoliday(null);
            setEditForm(INITIAL_FORM);
            toast({ title: 'Feriado atualizado com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao atualizar feriado.' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => holidaysService.remove(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
            setConfirmDeleteId(null);
            toast({ title: 'Feriado excluído com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao excluir feriado.' });
        },
    });

    const handleCreate = () => {
        if (!createForm.date) {
            toast({ variant: 'destructive', title: 'Data é obrigatória.' });
            return;
        }
        if (!createForm.name.trim()) {
            toast({ variant: 'destructive', title: 'Nome é obrigatório.' });
            return;
        }
        createMutation.mutate({
            date: createForm.date,
            name: createForm.name.trim(),
            store_id: createForm.store_id ? Number(createForm.store_id) : null,
        });
    };

    const handleUpdate = () => {
        if (!editingHoliday) return;
        if (!editForm.date) {
            toast({ variant: 'destructive', title: 'Data é obrigatória.' });
            return;
        }
        if (!editForm.name.trim()) {
            toast({ variant: 'destructive', title: 'Nome é obrigatório.' });
            return;
        }

        const payload: UpdateHolidayPayload = {
            date: editForm.date,
            name: editForm.name.trim(),
        };

        if (editForm.store_id === '') {
            // Was specific store, now clearing to "all"
            payload.store_id = null;
            payload.clear_store = true;
        } else {
            payload.store_id = Number(editForm.store_id);
        }

        updateMutation.mutate({ id: editingHoliday.id, payload });
    };

    const handleEdit = (holiday: Holiday) => {
        setEditingHoliday(holiday);
        setEditForm({
            date: holiday.date,
            name: holiday.name,
            store_id: holiday.store_id !== null ? String(holiday.store_id) : '',
        });
    };

    const openAddDialog = () => {
        setCreateForm({ ...INITIAL_FORM, date: new Date().toISOString().split('T')[0] });
        setAddDialogOpen(true);
    };

    const deletingHoliday = holidays.find((h) => h.id === confirmDeleteId);

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <CalendarOff className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Feriados
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Feriados nacionais, estaduais e por loja.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {/* Year filter */}
                    <Select
                        value={String(yearFilter)}
                        onValueChange={(v) => setYearFilter(Number(v))}
                    >
                        <SelectTrigger className="h-9 w-[110px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-300 focus:ring-[#F5A800] focus:border-[#F5A800]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-200">
                            {YEAR_OPTIONS.map((y) => (
                                <SelectItem key={y} value={String(y)}>
                                    {y}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {canEdit && (
                        <Button
                            onClick={openAddDialog}
                            className="font-semibold"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Novo Feriado
                        </Button>
                    )}
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="h-6 w-6 animate-spin text-[#999999] dark:text-zinc-400" />
                </div>
            ) : sortedHolidays.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <CalendarOff className="h-10 w-10 text-[#999999]/40 dark:text-zinc-400/40" />
                    <p className="text-sm text-[#666666] dark:text-zinc-500">
                        Nenhum feriado cadastrado para {yearFilter}.
                    </p>
                </div>
            ) : (
                <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center px-4 py-2 bg-gray-50 dark:bg-zinc-800/60 border-b border-[#D1D1D1] dark:border-[#333333]">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-28">Data</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400">Nome</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-36 text-center">Loja</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-12 text-center">Ações</span>
                    </div>

                    <div className="divide-y divide-[#E8E8E8] dark:divide-[#333333]">
                        {sortedHolidays.map((holiday) => (
                            <div
                                key={holiday.id}
                                className="grid grid-cols-[auto_1fr_auto_auto] items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                            >
                                <span className="w-28 font-mono text-sm text-[#111111] dark:text-zinc-200">
                                    {formatDateBR(holiday.date)}
                                </span>

                                <span className="text-sm font-medium text-[#111111] dark:text-zinc-200 truncate pr-3">
                                    {holiday.name}
                                </span>

                                <div className="w-36 flex justify-center">
                                    {holiday.store_id !== null ? (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-700/50 truncate max-w-full">
                                            {holiday.store_name ?? `Loja ${holiday.store_id}`}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border border-[#D1D1D1] dark:border-zinc-700">
                                            Todas as lojas
                                        </span>
                                    )}
                                </div>

                                <div className="w-12 flex items-center justify-center">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Ações"
                                                className="text-[#F5A800]"
                                            >
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {canEdit && (
                                                <DropdownMenuItem onClick={() => handleEdit(holiday)}>
                                                    <Edit className="h-4 w-4 mr-2" />
                                                    Editar
                                                </DropdownMenuItem>
                                            )}
                                            {canDelete && (
                                                <DropdownMenuItem
                                                    onClick={() => setConfirmDeleteId(holiday.id)}
                                                    className="text-red-600 focus:text-red-600"
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Excluir
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Dialog: Novo Feriado */}
            <Dialog
                open={addDialogOpen}
                onOpenChange={(open) => {
                    setAddDialogOpen(open);
                    if (!open) setCreateForm(INITIAL_FORM);
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Novo Feriado</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="holiday-date" className="text-[#666666] dark:text-zinc-300">
                                Data *
                            </Label>
                            <input
                                id="holiday-date"
                                type="date"
                                value={createForm.date}
                                onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })}
                                className="h-9 w-full rounded-md border border-[#D1D1D1] bg-white dark:bg-[#1A1A1A] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-white focus:outline-none focus:border-[#F5A800]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="holiday-name" className="text-[#666666] dark:text-zinc-300">
                                Nome *
                            </Label>
                            <Input
                                id="holiday-name"
                                placeholder="Ex: Carnaval"
                                value={createForm.name}
                                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="holiday-store" className="text-[#666666] dark:text-zinc-300">
                                Loja
                            </Label>
                            <Select
                                value={createForm.store_id}
                                onValueChange={(v) =>
                                    setCreateForm({ ...createForm, store_id: v === '__all__' ? '' : v })
                                }
                            >
                                <SelectTrigger
                                    id="holiday-store"
                                    className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800] focus:border-[#F5A800]"
                                >
                                    <SelectValue placeholder="Todas as lojas" />
                                </SelectTrigger>
                                <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-200">
                                    <SelectItem value="__all__">Todas as lojas</SelectItem>
                                    {allStores.map((s) => (
                                        <SelectItem key={s.id} value={String(s.id)}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-[#999999] dark:text-zinc-500">
                                Deixe em branco para aplicar a todas as lojas.
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setAddDialogOpen(false);
                                setCreateForm(INITIAL_FORM);
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
                            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Criar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog: Editar Feriado */}
            <Dialog
                open={editingHoliday !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditingHoliday(null);
                        setEditForm(INITIAL_FORM);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Editar Feriado</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-holiday-date" className="text-[#666666] dark:text-zinc-300">
                                Data *
                            </Label>
                            <input
                                id="edit-holiday-date"
                                type="date"
                                value={editForm.date}
                                onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                                className="h-9 w-full rounded-md border border-[#D1D1D1] bg-white dark:bg-[#1A1A1A] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-white focus:outline-none focus:border-[#F5A800]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-holiday-name" className="text-[#666666] dark:text-zinc-300">
                                Nome *
                            </Label>
                            <Input
                                id="edit-holiday-name"
                                placeholder="Ex: Carnaval"
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="edit-holiday-store" className="text-[#666666] dark:text-zinc-300">
                                Loja
                            </Label>
                            <Select
                                value={editForm.store_id || '__all__'}
                                onValueChange={(v) =>
                                    setEditForm({ ...editForm, store_id: v === '__all__' ? '' : v })
                                }
                            >
                                <SelectTrigger
                                    id="edit-holiday-store"
                                    className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800] focus:border-[#F5A800]"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-200">
                                    <SelectItem value="__all__">Todas as lojas</SelectItem>
                                    {allStores.map((s) => (
                                        <SelectItem key={s.id} value={String(s.id)}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setEditingHoliday(null);
                                setEditForm(INITIAL_FORM);
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
                            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* AlertDialog: Confirmar Exclusão */}
            <AlertDialog
                open={confirmDeleteId !== null}
                onOpenChange={(open) => !open && setConfirmDeleteId(null)}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Excluir Feriado</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Tem certeza que deseja excluir{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {deletingHoliday?.name ?? 'este feriado'}
                            </span>
                            {deletingHoliday ? ` (${formatDateBR(deletingHoliday.date)})` : ''}? Esta ação é{' '}
                            <span className="font-semibold text-red-600">irreversível</span>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => confirmDeleteId !== null && deleteMutation.mutate(confirmDeleteId)}
                            disabled={deleteMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Excluir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
