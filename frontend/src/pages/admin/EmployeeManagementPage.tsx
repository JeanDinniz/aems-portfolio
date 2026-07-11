import { useState } from 'react';
import { Plus, Users, UserCheck, UserMinus, UserX, Calendar } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeesTable } from '@/components/features/employees/EmployeesTable';
import { EmployeeFilters } from '@/components/features/employees/EmployeeFilters';
import { CreateEmployeeDialog } from '@/components/features/employees/CreateEmployeeDialog';
import { EmployeeFichaDialog } from '@/components/features/employees/EmployeeFichaDialog';
import { EmployeeMovementDialog } from '@/components/features/employees/EmployeeMovementDialog';
import { EmployeeHistoryDialog } from '@/components/features/employees/EmployeeHistoryDialog';
import { useEmployees, useEmployeeStats } from '@/hooks/useEmployees';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';
import type { Employee, EmployeeFilters as Filters } from '@/types/employee.types';

interface StatCardProps {
    icon: React.ElementType;
    label: string;
    value: number | undefined;
    isLoading: boolean;
    colorClass: string;
    iconColorClass: string;
}

function StatCard({ icon: Icon, label, value, isLoading, colorClass, iconColorClass }: StatCardProps) {
    return (
        <Card className="p-4">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${colorClass}`}>
                    <Icon className={`h-5 w-5 ${iconColorClass}`} />
                </div>
                <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    {isLoading ? (
                        <Skeleton className="h-7 w-12 mt-0.5" />
                    ) : (
                        <p className="text-2xl font-bold">{value ?? 0}</p>
                    )}
                </div>
            </div>
        </Card>
    );
}

export function EmployeeManagementPage() {
    const [filters, setFilters] = useState<Filters>({});
    const [page, setPage] = useState(1);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);

    // Selected employee for each dialog
    const [fichaEmployee, setFichaEmployee] = useState<Employee | null>(null);
    const [fichaOpen, setFichaOpen] = useState(false);
    const [movimentacaoEmployee, setMovimentacaoEmployee] = useState<Employee | null>(null);
    const [movimentacaoOpen, setMovimentacaoOpen] = useState(false);
    const [historicoEmployee, setHistoricoEmployee] = useState<Employee | null>(null);
    const [historicoOpen, setHistoricoOpen] = useState(false);

    const hasPermission = useAuthStore((s) => s.hasPermission);
    const canEdit = hasPermission('employees', 'edit');
    const { selectedStoreId } = useStoreStore();
    const debouncedSearch = useDebounce(filters.search);
    const { employees, total, isLoading } = useEmployees(
        { ...filters, search: debouncedSearch },
        page
    );
    const { data: stats, isLoading: statsLoading } = useEmployeeStats(selectedStoreId ?? undefined);

    const handleFicha = (employee: Employee) => {
        setFichaEmployee(employee);
        setFichaOpen(true);
    };

    const handleMovimentacao = (employee: Employee) => {
        setMovimentacaoEmployee(employee);
        setMovimentacaoOpen(true);
    };

    const handleHistorico = (employee: Employee) => {
        setHistoricoEmployee(employee);
        setHistoricoOpen(true);
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Funcionarios
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Gerencie os funcionarios e movimentacoes de RH das lojas.
                        </p>
                    </div>
                </div>
                {canEdit && (
                    <button
                        onClick={() => setCreateDialogOpen(true)}
                        className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold disabled:opacity-60 shrink-0"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Plus className="h-4 w-4" />
                        Cadastrar Funcionario
                    </button>
                )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatCard
                    icon={Users}
                    label="Total"
                    value={stats?.total}
                    isLoading={statsLoading}
                    colorClass="bg-blue-100 dark:bg-blue-900/30"
                    iconColorClass="text-blue-600 dark:text-blue-400"
                />
                <StatCard
                    icon={UserCheck}
                    label="Ativos"
                    value={stats?.active}
                    isLoading={statsLoading}
                    colorClass="bg-green-100 dark:bg-green-900/30"
                    iconColorClass="text-green-600 dark:text-green-400"
                />
                <StatCard
                    icon={UserMinus}
                    label="Afastados"
                    value={stats?.away}
                    isLoading={statsLoading}
                    colorClass="bg-yellow-100 dark:bg-yellow-900/30"
                    iconColorClass="text-yellow-600 dark:text-yellow-400"
                />
                <StatCard
                    icon={UserX}
                    label="Demitidos"
                    value={stats?.dismissed}
                    isLoading={statsLoading}
                    colorClass="bg-red-100 dark:bg-red-900/30"
                    iconColorClass="text-red-600 dark:text-red-400"
                />
                <StatCard
                    icon={Calendar}
                    label="Ferias Programadas"
                    value={stats?.vacations_planned}
                    isLoading={statsLoading}
                    colorClass="bg-purple-100 dark:bg-purple-900/30"
                    iconColorClass="text-purple-600 dark:text-purple-400"
                />
            </div>

            {/* Filtros */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4">
                <EmployeeFilters
                    filters={filters}
                    onFiltersChange={(f) => { setFilters(f); setPage(1); }}
                />
            </div>

            <EmployeesTable
                employees={employees}
                isLoading={isLoading}
                page={page}
                pageSize={20}
                total={total}
                onPageChange={setPage}
                onFicha={handleFicha}
                onMovimentacao={handleMovimentacao}
                onHistorico={handleHistorico}
            />

            <CreateEmployeeDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

            <EmployeeFichaDialog
                employee={fichaEmployee}
                open={fichaOpen}
                onOpenChange={setFichaOpen}
            />

            <EmployeeMovementDialog
                employee={movimentacaoEmployee}
                open={movimentacaoOpen}
                onOpenChange={setMovimentacaoOpen}
            />

            <EmployeeHistoryDialog
                employee={historicoEmployee}
                open={historicoOpen}
                onOpenChange={setHistoricoOpen}
            />
        </div>
    );
}
