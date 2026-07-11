import { useState, useEffect } from 'react';
import * as XLSXStyle from 'xlsx-js-style';
import { Plus, Edit, Eye, Trash2, ShieldCheck, Building2, Users, MoreHorizontal, Search, Download, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStores } from '@/hooks/useStores';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AccessProfileDialog } from '@/components/features/access-profiles/AccessProfileDialog';
import { useAccessProfiles, useUpdateAccessProfile, useDeleteAccessProfile } from '@/hooks/useAccessProfiles';
import { accessProfilesService } from '@/services/api/access-profiles.service';
import type { AccessProfile } from '@/types/accessProfile.types';

const SUB_MODULE_LABELS: Record<string, string> = {
    users: 'Usuários',
    stores: 'Lojas',
    consultants: 'Consultores',
    employees: 'Funcionários',
    brands: 'Marcas',
    models: 'Modelos',
    services: 'Serviços',
    profiles: 'Perfis',
    service_orders: 'Ordens de Serviço',
    conference: 'Conferência',
    fechamento: 'Fechamento',
    scheduling: 'Agendamentos',
    scheduling_os: 'Agend. → O.S.',
    inventory: 'Estoque',
};

export function AccessProfilesPage() {
    const [createOpen, setCreateOpen] = useState(false);
    const [editProfile, setEditProfile] = useState<AccessProfile | null>(null);
    const [deleteProfile, setDeleteProfile] = useState<AccessProfile | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [storeId, setStoreId] = useState<number | undefined>(undefined);

    const { stores } = useStores();

    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchInput);
            setPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput]);

    const PAGE_SIZE = 20;
    const { profiles, total, isLoading } = useAccessProfiles({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        store_id: storeId,
    });
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const updateMutation = useUpdateAccessProfile();
    const deleteMutation = useDeleteAccessProfile();

    const handleToggleActive = (profile: AccessProfile) => {
        updateMutation.mutate({
            id: profile.id,
            data: { is_active: !profile.is_active },
        });
    };

    const handleDelete = () => {
        if (!deleteProfile) return;
        deleteMutation.mutate(deleteProfile.id, {
            onSuccess: () => setDeleteProfile(null),
        });
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const result = await accessProfilesService.list({
                limit: 500,
                search: search || undefined,
                store_id: storeId,
            });

            const headers = ['Nome', 'Descrição', 'Permissões_Administrativo', 'Permissões_Operacional', 'Lojas', 'Usuários', 'Status'];
            const dataRows = result.items.map((p) => [
                p.name,
                p.description ?? '',
                p.permissions.filter((x) => x.module_group === 'ADM' && x.can_view).map((x) => SUB_MODULE_LABELS[x.sub_module] ?? x.sub_module).join(', '),
                p.permissions.filter((x) => x.module_group === 'OPERACIONAL' && x.can_view).map((x) => SUB_MODULE_LABELS[x.sub_module] ?? x.sub_module).join(', '),
                p.stores.map((s) => s.name).join(', '),
                p.user_ids.length,
                p.is_active ? 'Ativo' : 'Inativo',
            ]);

            const ws = XLSXStyle.utils.aoa_to_sheet([headers, ...dataRows]);

            const headerStyle = (sz: number) => ({
                font: { bold: true, sz, name: 'Aptos Narrow' },
                fill: { patternType: 'solid', fgColor: { rgb: 'FFC000' } },
            });
            headers.forEach((_, col) => {
                const addr = XLSXStyle.utils.encode_cell({ r: 0, c: col });
                if (ws[addr]) ws[addr].s = headerStyle(col === 0 ? 12 : 11);
            });

            const wb = XLSXStyle.utils.book_new();
            XLSXStyle.utils.book_append_sheet(wb, ws, 'Perfi_de_acesso');
            XLSXStyle.writeFile(wb, 'perfis_acesso.xlsx');
        } finally {
            setIsExporting(false);
        }
    };

    const getModuleBadges = (profile: AccessProfile) => {
        const hasAdm = profile.permissions.some((p) => p.module_group === 'ADM' && p.can_view);
        const hasOp = profile.permissions.some((p) => p.module_group === 'OPERACIONAL' && p.can_view);
        return { hasAdm, hasOp };
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Perfis de Acesso
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            {total} perfil{total !== 1 ? 'is' : ''} cadastrado{total !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isExporting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Download className="h-4 w-4" />
                        )}
                        Exportar
                    </button>
                    <button
                        onClick={() => setCreateOpen(true)}
                        className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-60"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Plus className="h-4 w-4" />
                        Novo Perfil
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
            <div className="flex flex-col md:flex-row gap-3">
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Buscar</span>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            placeholder="Nome do perfil..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="pl-8 w-64 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Loja</span>
                    <Select
                        value={storeId?.toString() ?? 'all'}
                        onValueChange={(v) => {
                            setStoreId(v === 'all' ? undefined : Number(v));
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="w-[220px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                            <SelectValue placeholder="Todas as lojas" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                            <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todas as lojas</SelectItem>
                            {stores.map((store) => (
                                <SelectItem key={store.id} value={store.id.toString()} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                    {store.code} - {store.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full" />
                    ))}
                </div>
            ) : (
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nome</TableHead>
                                <TableHead>Descrição</TableHead>
                                <TableHead>Módulos</TableHead>
                                <TableHead>
                                    <span className="flex items-center gap-1">
                                        <Building2 className="h-3.5 w-3.5" />
                                        Lojas
                                    </span>
                                </TableHead>
                                <TableHead>
                                    <span className="flex items-center gap-1">
                                        <Users className="h-3.5 w-3.5" />
                                        Usuários
                                    </span>
                                </TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right w-16">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {profiles.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="text-center text-[#666666] dark:text-zinc-500 py-12"
                                    >
                                        <div className="flex flex-col items-center gap-2">
                                            <ShieldCheck className="h-8 w-8 text-muted-foreground/40" />
                                            <p>Nenhum perfil de acesso cadastrado</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setCreateOpen(true)}
                                            >
                                                Criar primeiro perfil
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                profiles.map((profile) => {
                                    const { hasAdm, hasOp } = getModuleBadges(profile);
                                    return (
                                        <TableRow key={profile.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                                                    <span className="font-medium">{profile.name}</span>
                                                </div>
                                            </TableCell>

                                            <TableCell>
                                                <span className="text-sm text-muted-foreground line-clamp-1">
                                                    {profile.description || '—'}
                                                </span>
                                            </TableCell>

                                            <TableCell>
                                                <div className="flex gap-1 flex-wrap">
                                                    {hasAdm && (
                                                        <Badge variant="secondary" className="text-xs">
                                                            ADM
                                                        </Badge>
                                                    )}
                                                    {hasOp && (
                                                        <Badge variant="outline" className="text-xs">
                                                            Operacional
                                                        </Badge>
                                                    )}
                                                    {!hasAdm && !hasOp && (
                                                        <span className="text-xs text-muted-foreground">Sem permissões</span>
                                                    )}
                                                </div>
                                            </TableCell>

                                            <TableCell>
                                                {profile.stores.length === 0 ? (
                                                    <span className="text-muted-foreground">—</span>
                                                ) : (
                                                    <div
                                                        className="flex items-center gap-1 flex-wrap"
                                                        title={profile.stores.map((s) => s.name).join(', ')}
                                                    >
                                                        <span className="text-sm truncate max-w-[140px]">
                                                            {profile.stores[0].name}
                                                        </span>
                                                        {profile.stores.length > 1 && (
                                                            <Badge variant="secondary" className="text-xs shrink-0">
                                                                +{profile.stores.length - 1}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                )}
                                            </TableCell>

                                            <TableCell>
                                                <span className="text-sm">
                                                    {profile.user_ids.length > 0
                                                        ? `${profile.user_ids.length} usuário${profile.user_ids.length !== 1 ? 's' : ''}`
                                                        : <span className="text-muted-foreground">—</span>}
                                                </span>
                                            </TableCell>

                                            <TableCell>
                                                {profile.is_active ? (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700/50">
                                                        Ativo
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-200 dark:bg-zinc-800 text-[#444444] dark:text-zinc-400 border border-[#BDBDBD] dark:border-zinc-700">
                                                        Inativo
                                                    </span>
                                                )}
                                            </TableCell>

                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" aria-label="Ações" className="text-[#F5A800]">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setEditProfile(profile)}>
                                                            <Edit className="h-4 w-4 mr-2" />
                                                            Editar
                                                        </DropdownMenuItem>
                                                        {profile.is_active ? (
                                                            <DropdownMenuItem
                                                                onClick={() => handleToggleActive(profile)}
                                                                className="ring-1 ring-[#F5A800] ring-inset rounded-sm"
                                                            >
                                                                <Eye className="h-4 w-4 mr-2" />
                                                                Desativar
                                                            </DropdownMenuItem>
                                                        ) : (
                                                            <DropdownMenuItem onClick={() => handleToggleActive(profile)}>
                                                                <Eye className="h-4 w-4 mr-2 text-green-600" />
                                                                <span className="text-green-600">Ativar</span>
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuItem
                                                            onClick={() => setDeleteProfile(profile)}
                                                            className="text-red-600 focus:text-red-600"
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-2" />
                                                            Excluir
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-[#444444] dark:text-zinc-300">
                        Mostrando {(page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, total)} de {total} perfis
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                            Anterior
                        </Button>
                        <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>
                            Próximo
                        </Button>
                    </div>
                </div>
            )}

            {/* Create Dialog */}
            <AccessProfileDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
            />

            {/* Edit Dialog */}
            <AccessProfileDialog
                open={editProfile !== null}
                onOpenChange={(open) => { if (!open) setEditProfile(null); }}
                profile={editProfile}
            />

            {/* Delete Confirmation */}
            <AlertDialog
                open={deleteProfile !== null}
                onOpenChange={(open) => { if (!open) setDeleteProfile(null); }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir perfil de acesso?</AlertDialogTitle>
                        <AlertDialogDescription>
                            O perfil{' '}
                            <span className="font-semibold">{deleteProfile?.name}</span>{' '}
                            será excluído permanentemente. Os usuários vinculados perderão as permissões associadas.
                            Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
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
