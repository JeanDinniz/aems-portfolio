import { useState, useMemo } from 'react';
import { getApiErrorMessage } from '@/lib/api-error';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Film, MoreHorizontal, Trash2, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { inventoryService } from '@/services/api/inventory.service';
import type { FilmType, CreateFilmTypePayload, UpdateFilmTypePayload } from '@/services/api/inventory.service';
import { servicesService } from '@/services/api/services.service';
import brandsService from '@/services/api/brands.service';

// ─── FilmTypesPage ────────────────────────────────────────────────────────────

export function FilmTypesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Modal state
    const [createOpen, setCreateOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<FilmType | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<FilmType | null>(null);

    // Tabs & unified modal state
    const [activeTab, setActiveTab] = useState<'geral' | 'servicos'>('geral');
    const [savedFilmType, setSavedFilmType] = useState<FilmType | null>(null);

    // Table filter
    const [filterDepartment, setFilterDepartment] = useState<'all' | 'film' | 'security_film' | 'ppf'>('all');

    // Form state
    const [form, setForm] = useState<CreateFilmTypePayload>({
        name: '',
        department: 'film',
        yellow_threshold_meters: 0,
        red_threshold_meters: 0,
        available_tonalities: [],
    });
    const [addServiceForm, setAddServiceForm] = useState({ service_id: 0, meters_consumed: 0 });
    const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null);
    const [copyFromId, setCopyFromId] = useState<number | null>(null);
    const [copyingAll, setCopyingAll] = useState(false);

    // The "active" film type for the services tab: either the just-created one or the edit target
    const activeType = savedFilmType ?? editTarget;

    // canAccessServicos: services tab is only available when a type is already saved/selected
    const canAccessServicos = !!editTarget || !!savedFilmType;

    // Queries
    const { data, isLoading } = useQuery({
        queryKey: ['film-types', filterDepartment],
        queryFn: () => inventoryService.listFilmTypes({
            department: filterDepartment !== 'all' ? filterDepartment : undefined,
        }),
    });

    const serviceDepartment = activeType?.department;
    const { data: servicesData } = useQuery({
        queryKey: ['services', serviceDepartment],
        queryFn: () => servicesService.list({
            department: serviceDepartment,
            is_active: true,
            limit: 200,
        }),
        enabled: !!activeType,
    });

    const { data: brandsData } = useQuery({
        queryKey: ['brands', 'active'],
        queryFn: () => brandsService.list({ is_active: true }),
        enabled: activeTab === 'servicos',
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: (payload: CreateFilmTypePayload) => inventoryService.createFilmType(payload),
        onSuccess: (created) => {
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            setSavedFilmType(created);
            setActiveTab('servicos');
            toast({ title: 'Tipo criado — vincule os serviços' });
        },
        onError: (err: unknown) => {
            toast({ title: getApiErrorMessage(err as Error, 'Erro ao criar tipo'), variant: 'destructive' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateFilmTypePayload }) =>
            inventoryService.updateFilmType(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            toast({ title: 'Tipo atualizado' });
        },
        onError: (err: unknown) => {
            toast({ title: getApiErrorMessage(err as Error, 'Erro ao atualizar'), variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => inventoryService.deleteFilmType(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            setDeleteTarget(null);
            toast({ title: 'Tipo de película excluído com sucesso' });
        },
        onError: (err: unknown) => {
            setDeleteTarget(null);
            toast({
                title: 'Não foi possível excluir',
                description: getApiErrorMessage(err as Error, 'Erro ao excluir tipo de película.'),
                variant: 'destructive',
            });
        },
    });

    const addServiceMutation = useMutation({
        mutationFn: ({ filmTypeId, payload }: { filmTypeId: number; payload: { service_id: number; meters_consumed: number } }) =>
            inventoryService.addServiceToFilmType(filmTypeId, payload),
        onSuccess: (newLink) => {
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            const append = (prev: FilmType | null) =>
                prev ? { ...prev, services: [...(prev.services ?? []), newLink] } : null;
            if (savedFilmType) setSavedFilmType(append);
            else if (editTarget) setEditTarget(append);
            setAddServiceForm({ service_id: 0, meters_consumed: 0 });
            toast({ title: 'Serviço vinculado' });
        },
    });

    const removeServiceMutation = useMutation({
        mutationFn: ({ filmTypeId, serviceId }: { filmTypeId: number; serviceId: number }) =>
            inventoryService.removeServiceFromFilmType(filmTypeId, serviceId),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            const removeId = variables.serviceId;
            if (savedFilmType) {
                setSavedFilmType((prev) => prev
                    ? { ...prev, services: prev.services.filter((s) => s.service_id !== removeId) }
                    : null);
            } else if (editTarget) {
                setEditTarget((prev) => prev
                    ? { ...prev, services: prev.services.filter((s) => s.service_id !== removeId) }
                    : null);
            }
            toast({ title: 'Serviço removido' });
        },
    });

    // Derived
    const filmTypes = data?.items ?? [];
    const allServices = servicesData?.items ?? [];
    const brands = brandsData?.items ?? [];

    const linkedIds = useMemo(() => (activeType?.services ?? []).map((s) => s.service_id), [activeType]);

    const availableServices = useMemo(
        () => allServices
            .filter((s) => !linkedIds.includes(s.id) && (!selectedBrandId || s.brand_id === selectedBrandId))
            .sort((a, b) => {
                const labelA = `${a.code ?? ''} ${a.name}`.trim().toLowerCase();
                const labelB = `${b.code ?? ''} ${b.name}`.trim().toLowerCase();
                return labelA.localeCompare(labelB, 'pt-BR');
            }),
        [allServices, linkedIds, selectedBrandId]
    );

    const serviceMap = useMemo(() => {
        const map = new Map<number, (typeof allServices)[0]>();
        allServices.forEach((s) => map.set(s.id, s));
        return map;
    }, [allServices]);

    const siblingServices = useMemo(() => {
        if (!addServiceForm.service_id) return [];
        const selected = allServices.find((s) => s.id === addServiceForm.service_id);
        if (!selected?.code) return [];
        return allServices.filter(
            (s) => s.code === selected.code && s.id !== selected.id && !linkedIds.includes(s.id)
        );
    }, [addServiceForm.service_id, allServices, linkedIds]);

    // Handlers
    const closeModal = () => {
        setCreateOpen(false);
        setEditTarget(null);
        setSavedFilmType(null);
        setActiveTab('geral');
        setForm({ name: '', department: 'film', yellow_threshold_meters: 0, red_threshold_meters: 0, available_tonalities: [] });
        setAddServiceForm({ service_id: 0, meters_consumed: 0 });
        setSelectedBrandId(null);
        setCopyFromId(null);
        setCopyingAll(false);
    };

    const openEdit = (ft: FilmType) => {
        setForm({
            name: ft.name,
            department: ft.department,
            yellow_threshold_meters: ft.yellow_threshold_meters,
            red_threshold_meters: ft.red_threshold_meters,
            available_tonalities: ft.available_tonalities ?? [],
        });
        setEditTarget(ft);
        setActiveTab('geral');
    };

    const handleSaveGeral = () => {
        if (!form.name.trim()) {
            toast({ title: 'Informe o nome do tipo', variant: 'destructive' });
            return;
        }
        if (!form.yellow_threshold_meters || form.yellow_threshold_meters <= 0) {
            toast({ title: 'Informe o Limiar Amarelo (metros)', variant: 'destructive' });
            return;
        }
        if (!form.red_threshold_meters || form.red_threshold_meters <= 0) {
            toast({ title: 'Informe o Limiar Vermelho (metros)', variant: 'destructive' });
            return;
        }
        if (form.red_threshold_meters >= form.yellow_threshold_meters) {
            toast({ title: 'Limiar Vermelho deve ser menor que o Amarelo', variant: 'destructive' });
            return;
        }
        if (editTarget) {
            updateMutation.mutate({ id: editTarget.id, payload: form });
        } else {
            createMutation.mutate(form);
        }
    };

    const handleBrandChange = (val: string) => {
        setSelectedBrandId(val ? Number(val) : null);
        setAddServiceForm((f) => ({ ...f, service_id: 0 }));
    };

    const handleAddAllBrands = async () => {
        if (!addServiceForm.service_id || !addServiceForm.meters_consumed || !activeType) return;
        const allIds = [addServiceForm.service_id, ...siblingServices.map((s) => s.id)];
        const newLinks = await Promise.all(
            allIds.map((service_id) =>
                inventoryService.addServiceToFilmType(activeType.id, {
                    service_id,
                    meters_consumed: addServiceForm.meters_consumed,
                })
            )
        );
        const append = (prev: FilmType | null) =>
            prev ? { ...prev, services: [...(prev.services ?? []), ...newLinks] } : null;
        if (savedFilmType) setSavedFilmType(append);
        else if (editTarget) setEditTarget(append);
        queryClient.invalidateQueries({ queryKey: ['film-types'] });
        setAddServiceForm({ service_id: 0, meters_consumed: 0 });
        toast({ title: `${allIds.length} serviços vinculados` });
    };

    const handleCopyFrom = async () => {
        if (!copyFromId || !activeType) return;
        const source = filmTypes.find((ft) => ft.id === copyFromId);
        if (!source) return;
        const toAdd = (source.services ?? []).filter((s) => !linkedIds.includes(s.service_id));
        if (toAdd.length === 0) {
            toast({ title: 'Nenhum serviço novo para copiar' });
            setCopyFromId(null);
            return;
        }
        setCopyingAll(true);
        const newLinks = await Promise.all(
            toAdd.map((s) =>
                inventoryService.addServiceToFilmType(activeType.id, {
                    service_id: s.service_id,
                    meters_consumed: s.meters_consumed,
                })
            )
        );
        const append = (prev: FilmType | null) =>
            prev ? { ...prev, services: [...(prev.services ?? []), ...newLinks] } : null;
        if (savedFilmType) setSavedFilmType(append);
        else if (editTarget) setEditTarget(append);
        queryClient.invalidateQueries({ queryKey: ['film-types'] });
        setCopyingAll(false);
        setCopyFromId(null);
        toast({ title: `${toAdd.length} serviços copiados de "${source.name}"` });
    };

    const isModalOpen = createOpen || !!editTarget;

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            <div className="space-y-3">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                            <Film className="w-5 h-5" style={{ color: '#F5A800' }} />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}>
                                Tipos de Película
                            </h1>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">
                                Tipos de película com limiares de alerta de estoque
                            </p>
                        </div>
                    </div>
                    <Button className="shrink-0" onClick={() => { setForm({ name: '', department: 'film', yellow_threshold_meters: 0, red_threshold_meters: 0, available_tonalities: [] }); setCreateOpen(true); }}>
                        <Plus className="h-4 w-4 mr-2" />
                        Novo Tipo
                    </Button>
                </div>

                {/* Filtros */}
                <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-[#666666] dark:text-zinc-400 uppercase tracking-wide">Departamento</span>
                        <div className="flex gap-1.5">
                            {(['all', 'film', 'security_film', 'ppf'] as const).map((dept) => (
                                <button
                                    key={dept}
                                    onClick={() => setFilterDepartment(dept)}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                                        filterDepartment === dept
                                            ? 'bg-[#F5A800] text-white border-[#F5A800]'
                                            : 'border-[#D1D1D1] dark:border-[#333333] hover:bg-gray-50 dark:hover:bg-zinc-800'
                                    }`}
                                >
                                    {dept === 'all' ? 'Todos' : dept === 'film' ? 'Película' : dept === 'security_film' ? 'Pel. Segurança' : 'PPF'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabela */}
            {isLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="px-4 py-3 text-left font-medium">Nome</th>
                                <th className="px-4 py-3 text-left font-medium">Depto</th>
                                <th className="px-4 py-3 text-left font-medium">Limiar Amarelo</th>
                                <th className="px-4 py-3 text-left font-medium">Limiar Vermelho</th>
                                <th className="px-4 py-3 text-left font-medium">Serviços</th>
                                <th className="px-4 py-3 text-left font-medium">Status</th>
                                <th className="px-4 py-3 w-12" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filmTypes.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                                        Nenhum tipo cadastrado
                                    </td>
                                </tr>
                            )}
                            {filmTypes.map((ft) => (
                                <tr key={ft.id} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-4 py-3 font-medium">{ft.name}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                            ft.department === 'ppf'
                                                ? 'bg-purple-100 text-purple-700'
                                                : ft.department === 'security_film'
                                                ? 'bg-cyan-100 text-cyan-700'
                                                : 'bg-blue-100 text-blue-700'
                                        }`}>
                                            {ft.department === 'ppf'
                                                ? 'PPF'
                                                : ft.department === 'security_film'
                                                ? 'Pel. Segurança'
                                                : 'Película'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="text-yellow-600 font-medium">{ft.yellow_threshold_meters}m</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="text-red-600 font-medium">{ft.red_threshold_meters}m</span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {ft.services.slice(0, 4).map((s) => (
                                                <span key={s.service_id} className="text-xs px-1.5 py-0.5 rounded bg-muted border border-border">
                                                    {s.service_code}[{s.meters_consumed}m]
                                                </span>
                                            ))}
                                            {ft.services.length > 4 && (
                                                <span className="text-xs text-muted-foreground">+{ft.services.length - 4}</span>
                                            )}
                                            {ft.services.length === 0 && (
                                                <span className="text-xs text-muted-foreground">Nenhum</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ft.is_active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                                            {ft.is_active ? 'Ativo' : 'Inativo'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => openEdit(ft)}>
                                                    <Edit className="h-4 w-4 mr-2" /> Editar
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="text-destructive focus:text-destructive"
                                                    onClick={() => setDeleteTarget(ft)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" /> Excluir
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Modal unificado criar/editar + serviços */}
            <Dialog open={isModalOpen} onOpenChange={(o) => { if (!o) closeModal(); }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editTarget ? `Editar — ${editTarget.name}` : 'Novo Tipo'}</DialogTitle>
                    </DialogHeader>

                    {/* Abas */}
                    <div className="flex border-b border-border">
                        <button
                            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                activeTab === 'geral'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setActiveTab('geral')}
                        >
                            Geral
                        </button>
                        <button
                            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                activeTab === 'servicos'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                            } ${!canAccessServicos ? 'opacity-40 cursor-not-allowed' : ''}`}
                            onClick={() => canAccessServicos && setActiveTab('servicos')}
                            disabled={!canAccessServicos}
                        >
                            Serviços {!canAccessServicos && '(salve primeiro)'}
                        </button>
                    </div>

                    {/* Aba Geral */}
                    {activeTab === 'geral' && (
                        <div className="space-y-4 py-2">
                            <div className="space-y-1.5">
                                <Label>Nome</Label>
                                <Input
                                    placeholder="Ex: Poliéster, Fumê, PPF Transparente..."
                                    value={form.name}
                                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label>Departamento</Label>
                                <div className="flex gap-2">
                                    {(['film', 'security_film', 'ppf'] as const).map((dept) => (
                                        <button
                                            key={dept}
                                            type="button"
                                            onClick={() => setForm((f) => ({
                                                ...f,
                                                department: dept,
                                                // "Incolor" só é válido p/ película de segurança
                                                available_tonalities: dept === 'security_film'
                                                    ? (f.available_tonalities ?? [])
                                                    : (f.available_tonalities ?? []).filter((t) => t !== 'Incolor'),
                                            }))}
                                            className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                                                form.department === dept
                                                    ? 'bg-primary text-primary-foreground border-primary'
                                                    : 'border-border hover:bg-muted'
                                            }`}
                                        >
                                            {dept === 'film' ? 'Película' : dept === 'security_film' ? 'Pel. Segurança' : 'PPF'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Limiar Amarelo (m)</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={form.yellow_threshold_meters || ''}
                                    onChange={(e) => setForm((f) => ({ ...f, yellow_threshold_meters: Number(e.target.value) }))}
                                />
                                <p className="text-xs text-muted-foreground">Metragem restante a partir da qual a bobina vira amarela</p>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Limiar Vermelho (m)</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={form.red_threshold_meters || ''}
                                    onChange={(e) => setForm((f) => ({ ...f, red_threshold_meters: Number(e.target.value) }))}
                                />
                                <p className="text-xs text-muted-foreground">Metragem restante a partir da qual a bobina vira vermelha</p>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Tonalidades disponíveis</Label>
                                <div className="flex flex-wrap gap-2">
                                    {(['G05', 'G20', 'G35', 'G50', 'G75', ...(form.department === 'security_film' ? ['Incolor'] : [])]).map((ton) => {
                                        const selected = (form.available_tonalities ?? []).includes(ton)
                                        return (
                                            <button
                                                key={ton}
                                                type="button"
                                                onClick={() => setForm((f) => {
                                                    const cur = f.available_tonalities ?? []
                                                    return { ...f, available_tonalities: selected ? cur.filter((t) => t !== ton) : [...cur, ton] }
                                                })}
                                                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                                                    selected
                                                        ? 'bg-primary text-primary-foreground border-primary'
                                                        : 'border-border hover:bg-muted'
                                                }`}
                                            >
                                                {ton}
                                            </button>
                                        )
                                    })}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Tonalidades que aparecem ao lançar O.S. deste tipo. &quot;Incolor&quot; só está disponível para Película de Segurança.
                                </p>
                            </div>

                            <DialogFooter className="pt-2">
                                <Button variant="outline" onClick={closeModal}>Cancelar</Button>
                                <Button
                                    disabled={createMutation.isPending || updateMutation.isPending}
                                    onClick={handleSaveGeral}
                                >
                                    {(createMutation.isPending || updateMutation.isPending) && (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    )}
                                    Salvar
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* Aba Serviços */}
                    {activeTab === 'servicos' && activeType && (
                        <div className="space-y-4 py-2">
                            {/* Copiar de outro tipo */}
                            <div className="flex gap-2 items-center">
                                <Select
                                    value={copyFromId ? copyFromId.toString() : ''}
                                    onValueChange={(v) => setCopyFromId(Number(v))}
                                >
                                    <SelectTrigger className="flex-1">
                                        <SelectValue placeholder="Copiar serviços de outro tipo..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {filmTypes
                                            .filter((ft) => ft.id !== activeType.id)
                                            .map((ft) => (
                                                <SelectItem key={ft.id} value={ft.id.toString()}>
                                                    {ft.name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                <Button
                                    variant="outline"
                                    disabled={!copyFromId || copyingAll}
                                    onClick={handleCopyFrom}
                                >
                                    {copyingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Copiar'}
                                </Button>
                            </div>

                            {/* Adicionar serviço */}
                            <div className="space-y-3">
                                <p className="text-sm font-medium">Adicionar Serviço</p>

                                {/* Filtro por Marca */}
                                <Select
                                    value={selectedBrandId ? selectedBrandId.toString() : ''}
                                    onValueChange={handleBrandChange}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Todas as marcas" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {brands.map((b) => (
                                            <SelectItem key={b.id} value={b.id.toString()}>
                                                {b.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {/* Seleção do serviço */}
                                <Select
                                    value={addServiceForm.service_id ? addServiceForm.service_id.toString() : ''}
                                    onValueChange={(v) => setAddServiceForm((f) => ({ ...f, service_id: Number(v) }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione o serviço" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableServices.map((s) => (
                                            <SelectItem key={s.id} value={s.id.toString()}>
                                                {s.code ? `${s.code} - ` : ''}{s.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        min={0.1}
                                        step={0.5}
                                        placeholder="Metros consumidos"
                                        value={addServiceForm.meters_consumed || ''}
                                        onChange={(e) => setAddServiceForm((f) => ({ ...f, meters_consumed: Number(e.target.value) }))}
                                    />
                                    <Button
                                        onClick={() => {
                                            if (!addServiceForm.service_id || !addServiceForm.meters_consumed) {
                                                toast({ title: 'Selecione o serviço e informe os metros', variant: 'destructive' });
                                                return;
                                            }
                                            addServiceMutation.mutate({ filmTypeId: activeType.id, payload: addServiceForm });
                                        }}
                                        disabled={addServiceMutation.isPending}
                                    >
                                        {addServiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                    </Button>
                                    {siblingServices.length > 0 && (
                                        <Button
                                            variant="outline"
                                            onClick={handleAddAllBrands}
                                            disabled={!addServiceForm.meters_consumed}
                                            title="Adicionar para todas as marcas com o mesmo código"
                                        >
                                            + Todas ({siblingServices.length + 1})
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {/* Lista atual */}
                            <div className="border-t border-border pt-4 space-y-2 max-h-[320px] overflow-y-auto pr-1">
                                {(activeType.services ?? []).length === 0 && (
                                    <p className="text-sm text-muted-foreground">Nenhum serviço vinculado.</p>
                                )}
                                {[...(activeType.services ?? [])].sort((a, b) => {
                                    const codeA = `${a.service_code ?? ''} ${a.service_name ?? ''}`.trim().toLowerCase();
                                    const codeB = `${b.service_code ?? ''} ${b.service_name ?? ''}`.trim().toLowerCase();
                                    return codeA.localeCompare(codeB, 'pt-BR');
                                }).map((s) => {
                                    const svc = serviceMap.get(s.service_id);
                                    return (
                                        <div key={s.service_id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                                            <div>
                                                <p className="text-sm font-medium">{s.service_name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {svc?.brand?.name ? `${svc.brand.name} · ` : ''}
                                                    {s.service_code} — {s.meters_consumed}m por serviço
                                                </p>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-destructive hover:text-destructive"
                                                onClick={() => removeServiceMutation.mutate({ filmTypeId: activeType.id, serviceId: s.service_id })}
                                                disabled={removeServiceMutation.isPending}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>

                            <DialogFooter className="pt-2">
                                <Button variant="outline" onClick={closeModal}>Fechar</Button>
                            </DialogFooter>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Confirmação exclusão */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir tipo de película?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{deleteTarget?.name}" será excluído permanentemente. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                        >
                            Excluir permanentemente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
