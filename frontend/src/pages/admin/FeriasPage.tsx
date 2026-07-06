import { useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useVacations } from '@/hooks/useEmployees';
import { useStores } from '@/hooks/useStores';
import { EMPLOYEE_POSITIONS } from '@/constants/employees';
import type { VacationMovement } from '@/types/employee.types';

const MONTH_NAMES = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

const MONTH_NAMES_FULL = [
    'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function formatDate(dateStr?: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('pt-BR');
}

function formatDayMonth(dateStr?: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

function getVacationsForMonth(vacations: VacationMovement[], year: number, monthIndex: number): VacationMovement[] {
    return vacations.filter((v) => {
        const startDate = v.movement_data?.start_date;
        if (!startDate) return false;
        const d = new Date(startDate);
        return d.getFullYear() === year && d.getMonth() === monthIndex;
    });
}

function getStatusBadge(vacation: VacationMovement): { label: string; className: string } {
    const startDate = vacation.movement_data?.start_date;
    if (!startDate) return { label: 'Programada', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' };
    const start = new Date(startDate);
    const now = new Date();
    if (start > now) {
        return { label: 'Programada', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' };
    }
    return { label: 'Concluida', className: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400' };
}

interface VacationCardProps {
    vacation: VacationMovement;
}

function VacationCard({ vacation }: VacationCardProps) {
    const firstName = vacation.employee_name.split(' ')[0];
    const startDay = formatDayMonth(vacation.movement_data?.start_date);
    const returnDay = formatDayMonth(vacation.movement_data?.return_date);
    return (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/40 rounded p-1 text-xs mb-1">
            <div className="font-medium truncate">{firstName}</div>
            <div className="text-muted-foreground">{startDay} - {returnDay}</div>
        </div>
    );
}

interface AnnualViewProps {
    vacations: VacationMovement[];
    year: number;
    onYearChange: (year: number) => void;
}

function AnnualView({ vacations, year, onYearChange }: AnnualViewProps) {
    const MAX_VISIBLE = 3;

    return (
        <div className="space-y-4">
            {/* Year navigation */}
            <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => onYearChange(year - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-lg font-semibold w-16 text-center">{year}</span>
                <Button variant="outline" size="icon" onClick={() => onYearChange(year + 1)}>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            {/* Calendar grid */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                {/* Month headers */}
                <div className="grid grid-cols-12 border-b border-[#D1D1D1] dark:border-[#333333]">
                    {MONTH_NAMES.map((name) => (
                        <div key={name} className="p-2 text-center text-xs font-semibold text-muted-foreground border-r border-[#D1D1D1] dark:border-[#333333] last:border-0">
                            {name}
                        </div>
                    ))}
                </div>

                {/* Cells */}
                <div className="grid grid-cols-12 min-h-[120px]">
                    {MONTH_NAMES.map((_, monthIdx) => {
                        const monthVacations = getVacationsForMonth(vacations, year, monthIdx);
                        const visible = monthVacations.slice(0, MAX_VISIBLE);
                        const remaining = monthVacations.length - MAX_VISIBLE;

                        return (
                            <div
                                key={monthIdx}
                                className="p-1.5 border-r border-[#D1D1D1] dark:border-[#333333] last:border-0 align-top"
                            >
                                {visible.map((v) => (
                                    <VacationCard key={v.id} vacation={v} />
                                ))}
                                {remaining > 0 && (
                                    <div className="text-xs text-muted-foreground pl-1">
                                        +{remaining} mais
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

interface ListViewProps {
    vacations: VacationMovement[];
    isLoading: boolean;
}

function ListView({ vacations, isLoading }: ListViewProps) {
    if (isLoading) {
        return (
            <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
        );
    }

    return (
        <div className="rounded-md border overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Funcionario</TableHead>
                        <TableHead>Loja</TableHead>
                        <TableHead>Cargo</TableHead>
                        <TableHead>Inicio Ferias</TableHead>
                        <TableHead>Retorno</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {vacations.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                Nenhuma ferias registrada
                            </TableCell>
                        </TableRow>
                    ) : (
                        vacations.map((v) => {
                            const status = getStatusBadge(v);
                            return (
                                <TableRow key={v.id}>
                                    <TableCell className="font-medium">
                                        {v.employee_name}
                                        {v.employee_last_name ? ` ${v.employee_last_name}` : ''}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {v.employee_store_name || '—'}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {v.employee_position || '—'}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {formatDate(v.movement_data?.start_date)}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {formatDate(v.movement_data?.return_date)}
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${status.className}`}>
                                            {status.label}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </div>
    );
}

export default function FeriasPage() {
    const [view, setView] = useState<'annual' | 'list'>('annual');
    const [year, setYear] = useState(new Date().getFullYear());
    const [search, setSearch] = useState('');
    const [storeId, setStoreId] = useState<number | undefined>();
    const [position, setPosition] = useState<string | undefined>();

    const { stores } = useStores();
    const { data: vacations = [], isLoading } = useVacations({
        store_id: storeId,
        search: search || undefined,
        position: position || undefined,
    });

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <Calendar className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Programacao de Ferias
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Gestao de ferias dos colaboradores
                        </p>
                    </div>
                </div>

                {/* View toggle */}
                <div className="flex items-center gap-1 rounded-lg border border-[#D1D1D1] dark:border-[#333333] p-1 shrink-0">
                    <button
                        onClick={() => setView('annual')}
                        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                            view === 'annual'
                                ? 'text-[#1A1A1A] font-semibold'
                                : 'text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white'
                        }`}
                        style={view === 'annual' ? { backgroundColor: '#F5A800' } : {}}
                    >
                        Visao Anual
                    </button>
                    <button
                        onClick={() => setView('list')}
                        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                            view === 'list'
                                ? 'text-[#1A1A1A] font-semibold'
                                : 'text-[#666666] dark:text-zinc-400 hover:text-[#111111] dark:hover:text-white'
                        }`}
                        style={view === 'list' ? { backgroundColor: '#F5A800' } : {}}
                    >
                        Visao Lista
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Buscar</span>
                        <Input
                            placeholder="Buscar por nome"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="max-w-xs bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Loja</span>
                        <Select
                            value={storeId?.toString() || 'all'}
                            onValueChange={(v) => setStoreId(v === 'all' ? undefined : Number(v))}
                        >
                            <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                <SelectValue placeholder="Loja" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                <SelectItem value="all">Todas as lojas</SelectItem>
                                {stores?.map((store) => (
                                    <SelectItem key={store.id} value={store.id.toString()}>
                                        {store.code} - {store.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Cargo</span>
                        <Select
                            value={position || 'all'}
                            onValueChange={(v) => setPosition(v === 'all' ? undefined : v)}
                        >
                            <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                                <SelectValue placeholder="Cargo" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                                <SelectItem value="all">Todos os cargos</SelectItem>
                                {EMPLOYEE_POSITIONS.map((pos) => (
                                    <SelectItem key={pos.value} value={pos.value}>{pos.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Content */}
            {isLoading && view === 'annual' ? (
                <div className="grid grid-cols-12 gap-2">
                    {MONTH_NAMES_FULL.map((m) => <Skeleton key={m} className="h-32" />)}
                </div>
            ) : view === 'annual' ? (
                <AnnualView vacations={vacations} year={year} onYearChange={setYear} />
            ) : (
                <ListView vacations={vacations} isLoading={isLoading} />
            )}
        </div>
    );
}
