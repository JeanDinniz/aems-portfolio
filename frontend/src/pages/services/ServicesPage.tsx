import { useState, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, PackageSearch, MoreHorizontal, Edit, Trash2, Search, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import { servicesService } from '@/services/api/services.service';
import type { ServiceItem, ServiceCategory } from '@/services/api/services.service';
import { CategoryBadge } from '@/components/common/DepartmentBadge';
import brandsService from '@/services/api/brands.service';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { DEPARTMENTS } from '@/constants/service-orders';
import { getApiErrorMessage } from '@/lib/api-error';

const SERVICE_CATEGORIES: { value: ServiceCategory; label: string }[] = [
    { value: 'insulfilm', label: 'Película' },
    { value: 'pelicula_seguranca', label: 'Película de Segurança' },
    { value: 'ppf', label: 'PPF' },
    { value: 'estetica', label: 'Estética' },
];

interface AddServiceForm {
    name: string;
    code: string;
    brand_id: string;
    department: string;
    base_price: string;
    has_variable_price: boolean;
    is_courtesy_only: boolean;
    category: ServiceCategory | '';
    execution_time_minutes: string;
}

interface ServiceFormFieldsProps {
    form: AddServiceForm;
    setForm: Dispatch<SetStateAction<AddServiceForm>>;
    brands: { id: number; name: string }[];
    codeDuplicateWarning: boolean;
    setCodeDuplicateWarning: (v: boolean) => void;
    checkCodeDuplicate: (code: string) => void;
    editingService: ServiceItem | null;
}

const CATEGORY_NONE_VALUE = '__none__';

function ServiceFormFields({
    form,
    setForm,
    brands,
    codeDuplicateWarning,
    setCodeDuplicateWarning,
    checkCodeDuplicate,
}: ServiceFormFieldsProps) {
    return (
        <div className="space-y-4 py-2">
            {/* Ordem: Marca → Departamento → Código → Preço → Nome */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <Label className="text-[#666666] dark:text-zinc-300">Marca *</Label>
                    <Select
                        value={form.brand_id}
                        onValueChange={(v) => {
                            setForm((prev) => ({ ...prev, brand_id: v }));
                            setCodeDuplicateWarning(false);
                        }}
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
                    <Label className="text-[#666666] dark:text-zinc-300">Departamento</Label>
                    <Select
                        value={form.department}
                        onValueChange={(v) => {
                            setForm((prev) => ({ ...prev, department: v }));
                            setCodeDuplicateWarning(false);
                        }}
                    >
                        <SelectTrigger className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                            <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                            {DEPARTMENTS.map((d) => (
                                <SelectItem key={d.value} value={d.value} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                    {d.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="svc-code" className="text-[#666666] dark:text-zinc-300">Código</Label>
                    <Input
                        id="svc-code"
                        placeholder="Ex: LAV-001"
                        value={form.code}
                        onChange={(e) => {
                            setForm((prev) => ({ ...prev, code: e.target.value }));
                            setCodeDuplicateWarning(false);
                        }}
                        onBlur={(e) => checkCodeDuplicate(e.target.value)}
                        className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                    />
                    {codeDuplicateWarning && (
                        <p className="text-xs text-red-500">Ja existe um servico com este codigo para esta marca e departamento.</p>
                    )}
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="svc-price" className="text-[#666666] dark:text-zinc-300">
                        Preco Base (R$){form.has_variable_price ? '' : ' *'}
                    </Label>
                    <Input
                        id="svc-price"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={form.base_price}
                        onChange={(e) => setForm((prev) => ({ ...prev, base_price: e.target.value }))}
                        disabled={form.has_variable_price}
                        className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800] disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="flex items-center gap-3 pt-1">
                        <Switch
                            id="has_variable_price"
                            checked={form.has_variable_price}
                            onCheckedChange={(checked) => {
                                setForm((prev) => ({
                                    ...prev,
                                    has_variable_price: checked,
                                    base_price: checked ? '0' : prev.base_price,
                                }));
                            }}
                        />
                        <Label htmlFor="has_variable_price" className="text-sm font-medium cursor-pointer">
                            Valor variável <span className="text-muted-foreground font-normal">(definido na O.S.)</span>
                        </Label>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                        <Switch
                            id="is_courtesy_only"
                            checked={form.is_courtesy_only}
                            onCheckedChange={(checked) => {
                                setForm((prev) => ({ ...prev, is_courtesy_only: checked }));
                            }}
                        />
                        <div>
                            <Label htmlFor="is_courtesy_only" className="text-sm font-medium cursor-pointer">
                                Exclusivo de cortesia
                            </Label>
                            <p className="text-xs text-muted-foreground">Oculto em O.S. normais; aparece só em O.S. de cortesia.</p>
                        </div>
                    </div>
                </div>
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="svc-name" className="text-[#666666] dark:text-zinc-300">Nome do Servico *</Label>
                <Input
                    id="svc-name"
                    placeholder="Ex: Lavagem Simples"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <Label className="text-[#666666] dark:text-zinc-300">Categoria</Label>
                    <Select
                        value={form.category || CATEGORY_NONE_VALUE}
                        onValueChange={(v) =>
                            setForm((prev) => ({ ...prev, category: v === CATEGORY_NONE_VALUE ? '' : (v as ServiceCategory) }))
                        }
                    >
                        <SelectTrigger className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                            <SelectValue placeholder="Selecione uma categoria" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                            <SelectItem value={CATEGORY_NONE_VALUE} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                Sem categoria
                            </SelectItem>
                            {SERVICE_CATEGORIES.map((c) => (
                                <SelectItem key={c.value} value={c.value} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                    {c.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="svc-exec-time" className="text-[#666666] dark:text-zinc-300">Tempo de Execução (min)</Label>
                    <Input
                        id="svc-exec-time"
                        type="number"
                        min="1"
                        placeholder="Ex: 60"
                        value={form.execution_time_minutes}
                        onChange={(e) => setForm((prev) => ({ ...prev, execution_time_minutes: e.target.value }))}
                        className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                    />
                </div>
            </div>
        </div>
    );
}

const INITIAL_FORM: AddServiceForm = {
    name: '',
    code: '',
    brand_id: '',
    department: 'film',
    base_price: '',
    has_variable_price: false,
    is_courtesy_only: false,
    category: '',
    execution_time_minutes: '',
};

export default function ServicesPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [activeBrandId, setActiveBrandId] = useState<number | null>(null);
    const [activeDept, setActiveDept] = useState<string>('all');
    const [activeCategory, setActiveCategory] = useState<ServiceCategory | 'all'>('all');
    const [search, setSearch] = useState('');
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [editingService, setEditingService] = useState<ServiceItem | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
    const [form, setForm] = useState<AddServiceForm>(INITIAL_FORM);
    const [codeDuplicateWarning, setCodeDuplicateWarning] = useState(false);

    // Load brands from API
    const { data: brandsData, isLoading: brandsLoading } = useQuery({
        queryKey: ['brands', 'active'],
        queryFn: () => brandsService.list({ is_active: true }),
        staleTime: 1000 * 60 * 5,
    });

    const brands = brandsData?.items ?? [];
    const resolvedBrandId = activeBrandId; // null = Todos

    // Load all services at once
    const { data: allServices, isLoading: servicesLoading } = useQuery({
        queryKey: ['services', 'management'],
        queryFn: async () => {
            const result = await servicesService.list({ limit: 600 });
            return result.items;
        },
        staleTime: 1000 * 60 * 2,
    });

    const isLoading = brandsLoading || servicesLoading;

    // Filter by active brand and/or department, sorted by code A–Z
    const brandServices = useMemo(() => {
        let filtered = allServices ?? [];
        if (resolvedBrandId !== null) {
            filtered = filtered.filter((s) => s.brand_id === resolvedBrandId);
        }
        if (activeDept !== 'all') {
            filtered = filtered.filter((s) => s.department === activeDept);
        }
        if (activeCategory !== 'all') {
            filtered = filtered.filter((s) => s.category === activeCategory);
        }
        if (search.trim() !== '') {
            const q = search.toLowerCase();
            filtered = filtered.filter(
                (s) =>
                    s.name.toLowerCase().includes(q) ||
                    (s.code ?? '').toLowerCase().includes(q)
            );
        }
        return [...filtered].sort((a, b) => {
            if (a.code && b.code) return a.code.localeCompare(b.code);
            if (a.code) return -1;
            if (b.code) return 1;
            return a.name.localeCompare(b.name);
        });
    }, [allServices, resolvedBrandId, activeDept, activeCategory, search]);

    // Count per brand for badges
    const brandCounts = useMemo(() => {
        const counts: Record<number, number> = {};
        for (const brand of brands) {
            counts[brand.id] = allServices?.filter((s) => s.brand_id === brand.id).length ?? 0;
        }
        return counts;
    }, [allServices, brands]);

    // Duplicate code check on blur
    const checkCodeDuplicate = (code: string) => {
        if (!code.trim() || !form.brand_id || !form.department) {
            setCodeDuplicateWarning(false);
            return;
        }
        const brandIdNum = Number(form.brand_id);
        const exists = (allServices ?? []).some(
            (s) =>
                s.code?.toLowerCase() === code.toLowerCase() &&
                s.brand_id === brandIdNum &&
                s.department === form.department &&
                s.id !== editingService?.id
        );
        setCodeDuplicateWarning(exists);
    };

    const deactivateMutation = useMutation({
        mutationFn: (id: number) => servicesService.deactivate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['services'] });
            setConfirmDeleteId(null);
            toast({ title: 'Serviço removido com sucesso.' });
        },
        onError: () => {
            toast({ variant: 'destructive', title: 'Erro ao remover serviço.' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: () => {
            if (!editingService) throw new Error('No service selected');
            return servicesService.update(editingService.id, {
                name: form.name.trim(),
                department: form.department,
                base_price: form.has_variable_price ? 0 : (parseFloat(form.base_price) || 0),
                has_variable_price: form.has_variable_price,
                is_courtesy_only: form.is_courtesy_only,
                brand_id: Number(form.brand_id),
                code: form.code.trim() || null,
                category: form.category || null,
                execution_time_minutes: form.execution_time_minutes
                    ? parseInt(form.execution_time_minutes, 10) || null
                    : null,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['services'] });
            setEditingService(null);
            setForm(INITIAL_FORM);
            setCodeDuplicateWarning(false);
            toast({ title: 'Serviço atualizado com sucesso.' });
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao atualizar serviço.',
                description: getApiErrorMessage(error, 'Verifique os dados e tente novamente.'),
            });
        },
    });

    const createMutation = useMutation({
        mutationFn: () =>
            servicesService.create({
                name: form.name.trim(),
                department: form.department,
                base_price: form.has_variable_price ? 0 : (parseFloat(form.base_price) || 0),
                has_variable_price: form.has_variable_price,
                is_courtesy_only: form.is_courtesy_only,
                brand_id: Number(form.brand_id),
                code: form.code.trim() || null,
                category: form.category || null,
                execution_time_minutes: form.execution_time_minutes
                    ? parseInt(form.execution_time_minutes, 10) || null
                    : null,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['services'] });
            setAddDialogOpen(false);
            setForm(INITIAL_FORM);
            setCodeDuplicateWarning(false);
            toast({ title: 'Serviço adicionado com sucesso.' });
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao adicionar serviço.',
                description: getApiErrorMessage(error, 'Verifique os dados e tente novamente.'),
            });
        },
    });

    if (user?.role !== 'owner') {
        return <Navigate to="/" replace />;
    }

    const handleEdit = (svc: ServiceItem) => {
        setEditingService(svc);
        setCodeDuplicateWarning(false);
        setForm({
            name: svc.name,
            code: svc.code ?? '',
            brand_id: String(svc.brand_id),
            department: svc.department,
            base_price: svc.has_variable_price ? '0' : String(svc.base_price),
            has_variable_price: svc.has_variable_price ?? false,
            is_courtesy_only: svc.is_courtesy_only ?? false,
            category: svc.category ?? '',
            execution_time_minutes: svc.execution_time_minutes != null
                ? String(svc.execution_time_minutes)
                : '',
        });
    };

    const handleUpdate = () => {
        if (!form.name.trim()) {
            toast({ variant: 'destructive', title: 'Nome é obrigatório.' });
            return;
        }
        if (!form.brand_id) {
            toast({ variant: 'destructive', title: 'Marca é obrigatória.' });
            return;
        }
        if (!form.has_variable_price && (!form.base_price || isNaN(parseFloat(form.base_price)))) {
            toast({ variant: 'destructive', title: 'Preço base é obrigatório.' });
            return;
        }
        updateMutation.mutate();
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
        if (!form.has_variable_price && (!form.base_price || isNaN(parseFloat(form.base_price)))) {
            toast({ variant: 'destructive', title: 'Preço base é obrigatório.' });
            return;
        }
        createMutation.mutate();
    };

    const deptLabel = (key: string) =>
        DEPARTMENTS.find((d) => d.value === key)?.label ?? key;

    const handleExport = () => {
        if (!brandServices.length) return;
        const categoryLabel = (cat: ServiceCategory | null) =>
            SERVICE_CATEGORIES.find((c) => c.value === cat)?.label ?? '';
        const rows = brandServices.map((s) => ({
            'Nome do Serviço': s.name,
            'Código': s.code ?? '',
            'Departamento': deptLabel(s.department),
            'Categoria': categoryLabel(s.category),
            'Marca': s.brand?.name ?? '',
            'Valor': s.has_variable_price ? 'Variável' : Number(s.base_price).toFixed(2),
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Serviços');
        XLSX.writeFile(wb, 'servicos.xlsx');
    };

    const formFieldsProps: ServiceFormFieldsProps = {
        form,
        setForm,
        brands,
        codeDuplicateWarning,
        setCodeDuplicateWarning,
        checkCodeDuplicate,
        editingService,
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            <div className="space-y-3">
                {/* Cabecalho */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                            <PackageSearch className="w-5 h-5" style={{ color: '#F5A800' }} />
                        </div>
                        <div>
                            <h1
                                className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                            >
                                Serviços
                            </h1>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">
                                Catálogo de serviços por concessionária.
                                {allServices?.length ? ` ${allServices.length} serviços cadastrados.` : ''}
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <button
                            onClick={handleExport}
                            disabled={!brandServices.length}
                            className="flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-medium border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Download className="h-4 w-4" />
                            Exportar
                        </button>
                        <Button
                            onClick={() => {
                                setForm({
                                    ...INITIAL_FORM,
                                    brand_id: resolvedBrandId !== null ? String(resolvedBrandId) : '',
                                });
                                setCodeDuplicateWarning(false);
                                setAddDialogOpen(true);
                            }}
                            className="font-semibold"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Novo Serviço
                        </Button>
                    </div>
                </div>

                {/* Filtros */}
                {brands.length > 0 && (
                    <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                        <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Buscar</span>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                                    <Input
                                        placeholder="Buscar por nome ou código..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="pl-9 w-[220px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Marca</span>
                                <Select
                                    value={resolvedBrandId !== null ? String(resolvedBrandId) : 'all'}
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
                                                {brand.name}{(brandCounts[brand.id] ?? 0) > 0 ? ` (${brandCounts[brand.id]})` : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Departamento</span>
                                <Select
                                    value={activeDept}
                                    onValueChange={setActiveDept}
                                >
                                    <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                        <SelectValue placeholder="Departamento" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                            Todos
                                        </SelectItem>
                                        {DEPARTMENTS.map((d) => (
                                            <SelectItem
                                                key={d.value}
                                                value={d.value}
                                                className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white"
                                            >
                                                {d.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Categoria</span>
                                <Select
                                    value={activeCategory}
                                    onValueChange={(v) => setActiveCategory(v as ServiceCategory | 'all')}
                                >
                                    <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                        <SelectValue placeholder="Categoria" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                            Todas
                                        </SelectItem>
                                        {SERVICE_CATEGORIES.map((c) => (
                                            <SelectItem
                                                key={c.value}
                                                value={c.value}
                                                className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white"
                                            >
                                                {c.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                        </div>
                    </div>
                )}
            </div>

            {brands.length > 0 && (
                <div>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-6 w-6 animate-spin text-[#999999] dark:text-zinc-400" />
                        </div>
                    ) : !brandServices.length ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-2">
                            <PackageSearch className="h-10 w-10 text-[#CCCCCC] dark:text-zinc-400/40" />
                            <p className="text-sm text-[#999999] dark:text-zinc-500">
                                Nenhum servico encontrado para os filtros selecionados.
                            </p>
                        </div>
                    ) : (
                        <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                            {/* Header da tabela */}
                            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-x-4 px-4 py-2.5 bg-gray-100 dark:bg-zinc-800/60 border-b border-[#D1D1D1] dark:border-[#333333]">
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Nome do Serviço</span>
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Código</span>
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Departamento</span>
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Categoria</span>
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Marca</span>
                                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Valor</span>
                                <span className="w-16" />
                            </div>
                            {/* Linhas */}
                            <div className="divide-y divide-[#E8E8E8] dark:divide-[#333333]">
                                {brandServices.map((svc) => (
                                    <div
                                        key={svc.id}
                                        className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-x-4 items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                                    >
                                        <span className="text-sm text-[#111111] dark:text-zinc-200 truncate">{svc.name}</span>
                                        <span className="text-sm text-[#666666] dark:text-zinc-400 truncate">
                                            {svc.code ?? '—'}
                                        </span>
                                        <span className="text-sm text-[#666666] dark:text-zinc-400 truncate">
                                            {deptLabel(svc.department)}
                                        </span>
                                        <span>
                                            {svc.category ? (
                                                <CategoryBadge category={svc.category} />
                                            ) : (
                                                <span className="text-sm text-[#999999] dark:text-zinc-500">—</span>
                                            )}
                                        </span>
                                        <span className="text-sm text-[#666666] dark:text-zinc-400 truncate">
                                            {brands.find((b) => b.id === svc.brand_id)?.name ?? '—'}
                                        </span>
                                        <span className="text-sm text-[#111111] dark:text-zinc-200 font-medium">
                                            {svc.has_variable_price ? (
                                                <Badge variant="outline" className="text-xs font-normal">Variável</Badge>
                                            ) : (
                                                svc.base_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                                            )}
                                        </span>
                                        <div className="flex items-center justify-end shrink-0">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="text-[#F5A800]">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEdit(svc)}>
                                                        <Edit className="h-4 w-4 mr-2" />
                                                        Editar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => setConfirmDeleteId(svc.id)} className="text-red-600 focus:text-red-600">
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
                </div>
            )}

            {!brandsLoading && brands.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <PackageSearch className="h-10 w-10 text-[#CCCCCC] dark:text-zinc-400/40" />
                    <p className="text-sm text-[#999999] dark:text-zinc-500">
                        Nenhuma marca cadastrada. Cadastre marcas primeiro.
                    </p>
                </div>
            )}

            {/* Dialog: Adicionar Servico */}
            <Dialog
                open={addDialogOpen}
                onOpenChange={(open) => {
                    setAddDialogOpen(open);
                    if (!open) {
                        setForm(INITIAL_FORM);
                        setCodeDuplicateWarning(false);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Novo Servico</DialogTitle>
                    </DialogHeader>
                    <ServiceFormFields {...formFieldsProps} />
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setAddDialogOpen(false);
                                setForm(INITIAL_FORM);
                                setCodeDuplicateWarning(false);
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

            {/* Dialog: Editar Servico */}
            <Dialog
                open={editingService !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditingService(null);
                        setForm(INITIAL_FORM);
                        setCodeDuplicateWarning(false);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Editar Servico</DialogTitle>
                    </DialogHeader>
                    <ServiceFormFields {...formFieldsProps} />
                    <DialogFooter>
                        <Button
                            onClick={() => {
                                setEditingService(null);
                                setForm(INITIAL_FORM);
                                setCodeDuplicateWarning(false);
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

            {/* Dialog: Confirmar Remocao */}
            <AlertDialog
                open={confirmDeleteId !== null}
                onOpenChange={(open) => !open && setConfirmDeleteId(null)}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Remover Servico</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Tem certeza que deseja remover{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {allServices?.find((s) => s.id === confirmDeleteId)?.name ?? 'este servico'}
                            </span>
                            ? Ele nao aparecera mais nas ordens de servico.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() =>
                                confirmDeleteId !== null &&
                                deactivateMutation.mutate(confirmDeleteId)
                            }
                            disabled={deactivateMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deactivateMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Remover
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
