import { useQuery } from '@tanstack/react-query';
import { employeesService } from '@/services/api/employees.service';
import { Skeleton } from '@/components/ui/skeleton';
import type { Employee } from '@/types/employee.types';

const MONTH_NAMES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1; // 1-based

function EmployeeChip({ name }: { name: string }) {
    return (
        <span className="inline-flex items-center bg-muted rounded-full px-2.5 py-0.5 text-sm text-foreground">
            {name}
        </span>
    );
}

function MonthRow({ month, employees }: { month: number; employees: Employee[] }) {
    return (
        <div className="flex items-start gap-3 py-2 border-b border-border last:border-0">
            <div className="w-24 shrink-0">
                <span
                    className={`text-sm font-medium ${
                        month === CURRENT_MONTH
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-foreground'
                    }`}
                >
                    {MONTH_NAMES[month - 1]}
                </span>
            </div>
            <div className="flex flex-wrap gap-1.5 flex-1">
                {employees.length === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                ) : (
                    employees.map((e) => <EmployeeChip key={e.id} name={e.name} />)
                )}
            </div>
        </div>
    );
}

export function VacationTab() {
    const { data: allEmployees = [], isLoading } = useQuery({
        queryKey: ['employees', 'vacation-planning'],
        queryFn: () => employeesService.list({ is_active: true }, 1, 500),
        staleTime: 5 * 60 * 1000,
        select: (res) => res.employees,
    });

    // Planejamento de férias considera todos os funcionários acessíveis.
    const employees = allEmployees;

    // Group by vacation_month
    const byMonth: Record<number, Employee[]> = {};
    const noMonth: Employee[] = [];

    for (const emp of employees) {
        if (emp.vacation_month != null) {
            if (!byMonth[emp.vacation_month]) byMonth[emp.vacation_month] = [];
            byMonth[emp.vacation_month].push(emp);
        } else {
            noMonth.push(emp);
        }
    }

    const currentMonthEmployees = byMonth[CURRENT_MONTH] ?? [];

    if (isLoading) {
        return (
            <div className="space-y-3 p-4">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-4 w-48" />
                <div className="space-y-2 mt-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 py-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">
                    Planejamento de Férias — {CURRENT_YEAR}
                </h2>
                <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    {MONTH_NAMES[CURRENT_MONTH - 1]}
                </span>
            </div>

            {/* Mês atual em destaque */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Funcionários de férias este mês
                </p>
                {currentMonthEmployees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Nenhum funcionário com férias planejadas para este mês.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {currentMonthEmployees.map((e) => (
                            <EmployeeChip key={e.id} name={e.name} />
                        ))}
                    </div>
                )}
            </div>

            {/* Planejamento anual */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Planejamento Anual
                </p>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <MonthRow key={month} month={month} employees={byMonth[month] ?? []} />
                ))}

                {noMonth.length > 0 && (
                    <div className="flex items-start gap-3 py-2 pt-4">
                        <div className="w-24 shrink-0">
                            <span className="text-sm font-medium text-muted-foreground">Sem mês</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 flex-1">
                            {noMonth.map((e) => (
                                <EmployeeChip key={e.id} name={e.name} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
