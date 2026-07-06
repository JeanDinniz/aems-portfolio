import { useState } from 'react';
import { useServiceOrders, useUpdateServiceOrderStatus } from '@/hooks/useServiceOrders';
import { useStores } from '@/hooks/useStores';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Search, ClipboardList, AlertCircle, Zap, Pencil, ChevronDown } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { QuickCreateModal } from '@/components/features/service-orders/QuickCreateModal';
import { EditServicesModal } from '@/components/features/service-orders/EditServicesModal';
import { EmptyState } from '@/components/common/EmptyState';
import { DepartmentBadge } from '@/components/common/DepartmentBadge';
import type { Department, ServiceOrder } from '@/types/service-order.types';

const STATUS_COLORS: Record<string, string> = {
    waiting: 'border-[#D1D1D1] text-[#666666]',
    doing:   'border-[#F5A800] text-[#F5A800]',
    ready:   'border-[#22c55e] text-[#22c55e]',
    wrong:   'border-red-500 text-red-500',
};

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const STATUS_OPTIONS = [
    { value: 'waiting',     label: 'Aguardando'     },
    { value: 'in_progress', label: 'Em Andamento'   },
    { value: 'completed',   label: 'Finalizado'     },
    { value: 'wrong',       label: 'Lançado Errado' },
    { value: 'cancelled',   label: 'Cancelada'      },
];

function StatusMultiSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const [open, setOpen] = useState(false);
    const toggle = (val: string) =>
        onChange(value.includes(val) ? value.filter((s) => s !== val) : [...value, val]);

    const label =
        value.length === 0
            ? 'Todos'
            : value.length === 1
                ? (STATUS_OPTIONS.find((o) => o.value === value[0])?.label ?? 'Todos')
                : `${value.length} status`;

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="flex h-9 w-[150px] items-center justify-between gap-2 rounded-lg border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 text-sm text-[#111111] dark:text-zinc-300 cursor-pointer hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] focus:outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] transition-colors"
                >
                    <span className="truncate">{label}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[170px] p-1 border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A]">
                {STATUS_OPTIONS.map((opt) => (
                    <DropdownMenuCheckboxItem
                        key={opt.value}
                        checked={value.includes(opt.value)}
                        onSelect={(e) => { e.preventDefault(); toggle(opt.value); }}
                        className="text-sm text-[#111111] dark:text-white focus:bg-[#F5F5F5] dark:focus:bg-[#2A2A2A] [&>span]:border-2 [&>span]:border-[#F5A800] [&>span]:rounded-sm"
                    >
                        {opt.label}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function canEdit(os: ServiceOrder): boolean {
    if (os.is_verified) return false;
    const osDate = new Date(os.entry_time);
    const diffMs = Date.now() - osDate.getTime();
    return diffMs <= 7 * 24 * 60 * 60 * 1000;
}

export default function ServiceOrdersPage() {
    const [page, setPage] = useState(0);
    const pageSize = 10;
    const [quickCreateOpen, setQuickCreateOpen] = useState(false);
    const [editingOrder, setEditingOrder] = useState<ServiceOrder | null>(null);

    const [departmentFilter, setDepartmentFilter] = useState<Department | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [search, setSearch] = useState('');
    const today = new Date().toISOString().split('T')[0];
    const [startDate, setStartDate] = useState<string>(today);
    const [endDate, setEndDate] = useState<string>(today);

    const updateStatus = useUpdateServiceOrderStatus();

    const { stores, isMultiStore } = useStores();
    const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

    const { data, isLoading, isError } = useServiceOrders(
        {
            store_id: selectedStoreId ?? undefined,
            search: search || undefined,
            department: departmentFilter !== 'all' ? departmentFilter : undefined,
            status: statusFilter.length > 0 ? statusFilter : undefined,
            // Quando há busca, ignora filtro de data para buscar em qualquer período
            date_from: search ? undefined : startDate,
            date_to: search ? undefined : endDate,
        },
        page * pageSize,
        pageSize
    );

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value);
        setPage(0);
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5 page-enter">
            {/* Header + Filters — compactos */}
            <div className="space-y-2">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <ClipboardList className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Ordens de Serviço
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            {data?.total != null ? `${data.total} registros encontrados` : 'Gerencie todas as ordens do sistema'}
                        </p>
                    </div>
                </div>
                {/* Botão visível apenas em desktop */}
                <Button
                    onClick={() => setQuickCreateOpen(true)}
                    className="hidden sm:inline-flex font-semibold gap-2 shrink-0"
                    style={{ backgroundColor: '#F5A800', color: '#000' }}
                >
                    <Zap className="h-4 w-4" />
                    Lançar OS
                </Button>
            </div>

            {/* Botão Lançar OS — mobile full-width */}
            <Button
                onClick={() => setQuickCreateOpen(true)}
                className="sm:hidden w-full h-11 text-base font-bold gap-2 rounded-xl"
                style={{ backgroundColor: '#F5A800', color: '#000' }}
            >
                <Zap className="h-5 w-5" />
                Lançar OS
            </Button>

            {/* Filters */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
                {isMultiStore && (
                    <div className="space-y-1">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">LOJA</Label>
                        <Select
                            value={selectedStoreId !== null ? String(selectedStoreId) : 'all'}
                            onValueChange={(val) => {
                                setSelectedStoreId(val === 'all' ? null : Number(val));
                                setPage(0);
                            }}
                        >
                            <SelectTrigger className="h-9 w-full sm:w-[160px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-300 focus:ring-[#F5A800] focus:border-[#F5A800]">
                                <SelectValue placeholder="Todas as lojas" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-200">
                                <SelectItem value="all">Todas as lojas</SelectItem>
                                {stores.map((s) => (
                                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="space-y-1 flex-1 min-w-[200px]">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">BUSCA (PLACA/OS)</Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#999999] dark:text-zinc-500" />
                        <Input
                            placeholder="Buscar por placa ou nº OS..."
                            value={search}
                            onChange={handleSearch}
                            className="h-9 rounded-lg text-sm text-[#111111] dark:text-white border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] pl-8 pr-3 outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">DEPARTAMENTO</Label>
                    <Select value={departmentFilter} onValueChange={(val) => setDepartmentFilter(val as Department | 'all')}>
                        <SelectTrigger className="h-9 w-full sm:w-[150px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-300 focus:ring-[#F5A800] focus:border-[#F5A800]">
                            <SelectValue placeholder="Departamento" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-200">
                            <SelectItem value="all">Todos Depts</SelectItem>
                            <SelectItem value="film">Película</SelectItem>
                            <SelectItem value="security_film">Película de Segurança</SelectItem>
                            <SelectItem value="ppf">PPF</SelectItem>
                            <SelectItem value="vn">VN</SelectItem>
                            <SelectItem value="vd">Venda Direta</SelectItem>
                            <SelectItem value="vu">VU</SelectItem>
                            <SelectItem value="bodywork">Funilaria</SelectItem>
                            <SelectItem value="workshop">Oficina</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">STATUS</Label>
                    <StatusMultiSelect
                        value={statusFilter}
                        onChange={(v) => { setStatusFilter(v); setPage(0); }}
                    />
                </div>

                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground block">DATA INÍCIO</Label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                            setStartDate(e.target.value);
                            setPage(0);
                        }}
                        className="h-9 rounded-md border border-[#D1D1D1] bg-white dark:bg-[#1A1A1A] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-white focus:outline-none focus:border-[#F5A800]"
                    />
                </div>

                <div className="space-y-1">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground block">DATA FIM</Label>
                    <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        onChange={(e) => {
                            setEndDate(e.target.value);
                            setPage(0);
                        }}
                        className="h-9 rounded-md border border-[#D1D1D1] bg-white dark:bg-[#1A1A1A] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-white focus:outline-none focus:border-[#F5A800]"
                    />
                </div>
            </div>
            </div>{/* fim: Header + Filters */}

            {/* Cards — mobile only */}
            <div className="flex flex-col gap-3 sm:hidden">
                {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-[#E8E8E8] dark:border-[#333333] bg-white dark:bg-[#252525] p-4 space-y-2">
                            {Array.from({ length: 5 }).map((__, j) => (
                                <Skeleton key={j} className="h-4 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse" />
                            ))}
                        </div>
                    ))
                ) : isError ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        Erro ao carregar ordens de serviço.
                    </div>
                ) : data?.items.length === 0 ? (
                    <div className="rounded-xl border border-[#E8E8E8] dark:border-[#333333] bg-white dark:bg-[#252525]">
                        <EmptyState
                            icon={ClipboardList}
                            title={search ? 'Nenhuma O.S. encontrada' : 'Nenhuma ordem de serviço'}
                            description={search
                                ? `Nenhum resultado para "${search}".`
                                : 'Comece criando uma nova ordem de serviço.'}
                            actionLabel={!search ? 'Lançar OS' : undefined}
                            onAction={!search ? () => setQuickCreateOpen(true) : undefined}
                        />
                    </div>
                ) : (
                    data?.items.map((os) => {
                        const editEnabled = canEdit(os);
                        return (
                            <div key={os.id} className="rounded-xl border border-[#E8E8E8] dark:border-[#333333] bg-white dark:bg-[#252525] overflow-hidden shadow-sm">
                                {/* Info rows */}
                                <div className="p-4 space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-[#999999] dark:text-zinc-500 uppercase tracking-wide font-semibold">Data da OS</span>
                                        <span className="text-[#111111] dark:text-zinc-200">{os.entry_time ? formatDate(os.entry_time) : '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-[#999999] dark:text-zinc-500 uppercase tracking-wide font-semibold">Nº OS Conc.</span>
                                        <span className="text-[#111111] dark:text-zinc-200 font-mono">{os.external_os_number || '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-[#999999] dark:text-zinc-500 uppercase tracking-wide font-semibold">Departamento</span>
                                        <DepartmentBadge department={os.department} />
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-[#999999] dark:text-zinc-500 uppercase tracking-wide font-semibold">Placa</span>
                                        <span className="bg-gray-100 dark:bg-zinc-800 border border-[#D1D1D1] dark:border-zinc-700 text-[#111111] dark:text-white font-mono px-2 py-0.5 rounded text-xs tracking-widest">
                                            {os.plate}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-[#999999] dark:text-zinc-500 uppercase tracking-wide font-semibold">Veículo</span>
                                        <span className="text-[#111111] dark:text-zinc-200 text-right max-w-[55%] truncate">
                                            {os.vehicle_model}{os.vehicle_color ? ` · ${os.vehicle_color}` : ''}
                                        </span>
                                    </div>
                                    {os.notes && (
                                        <div className="flex items-start justify-between text-xs gap-2">
                                            <span className="text-[#999999] dark:text-zinc-500 uppercase tracking-wide font-semibold shrink-0">Observações</span>
                                            <span className="text-[#111111] dark:text-zinc-200 text-right line-clamp-2">{os.notes}</span>
                                        </div>
                                    )}
                                    {/* Serviços */}
                                    {(os.items ?? []).filter(i => i.service_name).length > 0 && (
                                        <div className="flex flex-wrap gap-1 pt-1">
                                            {(os.items ?? []).filter(i => i.service_name).map((item, i) => (
                                                <span key={i} className="inline-block text-xs bg-muted px-1.5 py-0.5 rounded">
                                                    {item.service_code ? `${item.service_code} - ${item.service_name}` : item.service_name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {/* Footer: Editar + Status */}
                                <div className="flex items-center gap-2 px-4 py-3 border-t border-[#E8E8E8] dark:border-[#333333] bg-gray-50 dark:bg-zinc-800/30">
                                    <button
                                        onClick={() => setEditingOrder(os)}
                                        disabled={!editEnabled}
                                        className={[
                                            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors',
                                            editEnabled
                                                ? 'border-[#F5A800] text-[#F5A800] hover:bg-[#F5A800]/10 cursor-pointer'
                                                : 'border-[#D1D1D1] text-[#BBBBBB] dark:border-[#444444] dark:text-[#555555] opacity-50 cursor-not-allowed',
                                        ].join(' ')}
                                    >
                                        <Pencil className="w-3 h-3" />
                                        Editar
                                    </button>
                                    <Select
                                        value={os.status}
                                        onValueChange={(value) => updateStatus.mutate({ id: os.id, status: value })}
                                    >
                                        <SelectTrigger
                                            className={[
                                                'h-8 flex-1 rounded-md border bg-white dark:bg-[#252525] px-2 text-xs font-semibold focus:ring-1 focus:ring-[#F5A800] focus:border-[#F5A800] cursor-pointer',
                                                STATUS_COLORS[os.status] ?? 'border-[#D1D1D1] text-[#666666]',
                                            ].join(' ')}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white rounded-lg shadow-lg">
                                            <SelectItem value="waiting" className="text-xs font-semibold text-[#666666] dark:text-zinc-400 focus:bg-zinc-100 dark:focus:bg-zinc-800">Aguardando</SelectItem>
                                            <SelectItem value="doing" className="text-xs font-semibold text-[#F5A800] focus:bg-zinc-100 dark:focus:bg-zinc-800">Desenvolvendo</SelectItem>
                                            <SelectItem value="ready" className="text-xs font-semibold text-[#22c55e] focus:bg-zinc-100 dark:focus:bg-zinc-800">Finalizado</SelectItem>
                                            <SelectItem value="wrong" className="text-xs font-semibold text-red-500 focus:bg-zinc-100 dark:focus:bg-zinc-800">Lançado Errado</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Table — desktop only */}
            <div className="hidden sm:block border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-gray-100 dark:bg-zinc-800/60 hover:bg-gray-100 dark:hover:bg-zinc-800/60 border-0">
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Ações</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Status</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Data da OS</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Nº OS Conc.</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Placa</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Veículo</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Departamento</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Serviços</TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide px-4 py-3">Observações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i} className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                    {Array.from({ length: 9 }).map((__, j) => (
                                        <TableCell key={j} className="px-4 py-3">
                                            <Skeleton className="h-5 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse" />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : isError ? (
                            <TableRow className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                <TableCell colSpan={9} className="px-4 py-3">
                                    <div className="flex items-center justify-center gap-2 py-8 text-red-400 text-sm">
                                        <AlertCircle className="w-4 h-4" />
                                        Erro ao carregar ordens de serviço. Tente recarregar a página.
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : data?.items.length === 0 ? (
                            <TableRow className="border-t border-[#E8E8E8] dark:border-[#333333]">
                                <TableCell colSpan={9} className="p-0">
                                    <EmptyState
                                        icon={ClipboardList}
                                        title={search ? 'Nenhuma O.S. encontrada' : 'Nenhuma ordem de serviço'}
                                        description={search
                                            ? `Nenhum resultado para "${search}". Tente outros termos.`
                                            : 'Comece criando uma nova ordem de serviço.'}
                                        actionLabel={!search ? 'Lançar OS' : undefined}
                                        onAction={!search ? () => setQuickCreateOpen(true) : undefined}
                                    />
                                </TableCell>
                            </TableRow>
                        ) : (
                            data?.items.map((os) => {
                                const editEnabled = canEdit(os);
                                return (
                                    <TableRow key={os.id} className="border-t border-[#E8E8E8] dark:border-[#333333] hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                                        {/* Ações */}
                                        <TableCell className="px-4 py-3">
                                            <button
                                                onClick={() => setEditingOrder(os)}
                                                disabled={!editEnabled}
                                                title={editEnabled ? 'Editar OS' : 'Edição disponível somente até 7 dias após a criação'}
                                                className={[
                                                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold transition-colors',
                                                    editEnabled
                                                        ? 'border-[#F5A800] text-[#F5A800] hover:bg-[#F5A800]/10 cursor-pointer'
                                                        : 'border-[#D1D1D1] text-[#BBBBBB] dark:border-[#444444] dark:text-[#555555] opacity-50 cursor-not-allowed',
                                                ].join(' ')}
                                            >
                                                <Pencil className="w-3 h-3" />
                                                Editar
                                            </button>
                                        </TableCell>
                                        {/* Status */}
                                        <TableCell className="px-4 py-3">
                                            <Select
                                                value={os.status}
                                                onValueChange={(value) =>
                                                    updateStatus.mutate({ id: os.id, status: value })
                                                }
                                            >
                                                <SelectTrigger
                                                    className={[
                                                        'h-8 w-36 rounded-md border bg-white dark:bg-[#252525] px-2 text-xs font-semibold focus:ring-1 focus:ring-[#F5A800] focus:border-[#F5A800] cursor-pointer',
                                                        STATUS_COLORS[os.status] ?? 'border-[#D1D1D1] text-[#666666]',
                                                    ].join(' ')}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white rounded-lg shadow-lg">
                                                    <SelectItem value="waiting" className="text-xs font-semibold text-[#666666] dark:text-zinc-400 focus:bg-zinc-100 dark:focus:bg-zinc-800">Aguardando</SelectItem>
                                                    <SelectItem value="doing" className="text-xs font-semibold text-[#F5A800] focus:bg-zinc-100 dark:focus:bg-zinc-800">Desenvolvendo</SelectItem>
                                                    <SelectItem value="ready" className="text-xs font-semibold text-[#22c55e] focus:bg-zinc-100 dark:focus:bg-zinc-800">Finalizado</SelectItem>
                                                    <SelectItem value="wrong" className="text-xs font-semibold text-red-500 focus:bg-zinc-100 dark:focus:bg-zinc-800">Lançado Errado</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        {/* Data da OS */}
                                        <TableCell className="px-4 py-3 text-xs text-[#666666] dark:text-zinc-400 whitespace-nowrap">
                                            {os.entry_time ? formatDate(os.entry_time) : '—'}
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200 font-mono text-xs">{os.external_os_number || '—'}</TableCell>
                                        <TableCell className="px-4 py-3">
                                            <span className="bg-gray-100 dark:bg-zinc-800 border border-[#D1D1D1] dark:border-zinc-700 text-[#111111] dark:text-white font-mono px-2 py-0.5 rounded text-sm tracking-widest">
                                                {os.plate}
                                            </span>
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-sm text-[#111111] dark:text-zinc-200">
                                            {os.vehicle_model}{os.vehicle_color ? ` · ${os.vehicle_color}` : ''}
                                        </TableCell>
                                        <TableCell className="px-4 py-3">
                                            <DepartmentBadge department={os.department} />
                                        </TableCell>
                                        <TableCell className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1">
                                                {(os.items ?? [])
                                                    .filter(item => item.service_name)
                                                    .map((item, i) => (
                                                        <span
                                                            key={i}
                                                            className="inline-block text-xs bg-muted px-1.5 py-0.5 rounded"
                                                        >
                                                            {item.service_code ? `${item.service_code} - ${item.service_name}` : item.service_name}
                                                        </span>
                                                    ))
                                                }
                                                {(!os.items || os.items.filter(item => item.service_name).length === 0) && (
                                                    <span className="text-muted-foreground text-xs">—</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-xs text-[#111111] dark:text-zinc-200 max-w-[180px]">
                                            {os.notes
                                                ? <span className="line-clamp-2 leading-snug" title={os.notes}>{os.notes}</span>
                                                : <span className="text-muted-foreground">—</span>
                                            }
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((old) => Math.max(0, old - 1))}
                    disabled={page === 0 || isLoading}
                    className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                >
                    Anterior
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((old) => old + 1)}
                    disabled={!data || data.items.length < pageSize || isLoading}
                    className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                >
                    Próximo
                </Button>
            </div>

            <QuickCreateModal
                open={quickCreateOpen}
                onClose={() => setQuickCreateOpen(false)}
            />

            {editingOrder && (
                <EditServicesModal
                    serviceOrder={editingOrder}
                    open={!!editingOrder}
                    onClose={() => setEditingOrder(null)}
                />
            )}
        </div>
    );
}
