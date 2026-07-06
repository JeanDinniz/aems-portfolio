import { ScrollView, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useEmployee, useEmployeeMovements } from '@/hooks/useEmployeesAdmin';
import { formatDateBR } from '@/utils/formatDate';
import { HR_STATUS_LABELS, MOVEMENT_TYPE_LABELS } from '@/constants/employees';
import type { Employee, EmployeeMovement } from '@/types/employee.types';
import type { AdminStackScreenProps } from '@/navigation/types';

/**
 * Ficha do funcionário (Admin — Fatia 5a). Dados + histórico de movimentações
 * (read; via `listMovements`). Sem ações de mutação nesta passada.
 */

function InfoRow({ label, value }: { label: string; value?: string | null }) {
    return (
        <View className="flex-row items-start justify-between border-b border-neutral-50 py-2.5 dark:border-dark-border-soft">
            <Text className="font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                {label}
            </Text>
            <Text
                className="ml-4 flex-1 text-right font-sans-medium text-sm text-neutral-800 dark:text-dark-text"
                numberOfLines={2}
            >
                {value ?? '—'}
            </Text>
        </View>
    );
}

function statusBadge(employee: Employee) {
    const status = employee.hr_status ?? (employee.is_active ? 'active' : 'dismissed');
    const variant = status === 'active' ? 'success' : status === 'away' ? 'warning' : 'neutral';
    return <Badge variant={variant} size="sm" label={HR_STATUS_LABELS[status] ?? 'Ativo'} />;
}

function MovementItem({ movement }: { movement: EmployeeMovement }) {
    return (
        <View className="flex-row items-start gap-3 border-b border-neutral-50 py-3 dark:border-dark-border-soft">
            <View className="mt-1 h-2 w-2 rounded-full bg-brand" />
            <View className="flex-1">
                <View className="flex-row items-center justify-between">
                    <Text className="font-sans-semibold text-sm text-neutral-800 dark:text-dark-text">
                        {MOVEMENT_TYPE_LABELS[movement.type] ?? movement.type}
                    </Text>
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                        {formatDateBR(movement.movement_date)}
                    </Text>
                </View>
                {movement.notes ? (
                    <Text className="mt-0.5 font-sans text-xs text-neutral-500 dark:text-dark-text-muted">
                        {movement.notes}
                    </Text>
                ) : null}
                {movement.created_by_name ? (
                    <Text className="mt-0.5 font-sans text-[11px] text-neutral-400 dark:text-dark-text-muted">
                        por {movement.created_by_name}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

export function EmployeeDetailScreen({ route, navigation }: AdminStackScreenProps<'EmployeeDetail'>) {
    const { id } = route.params;
    const { data: employee, isLoading, isError, refetch } = useEmployee(id);
    const { data: movements, isLoading: movementsLoading } = useEmployeeMovements(id);

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Funcionário" onBack={() => navigation.goBack()} />
                <View className="gap-4 p-4">
                    <Skeleton width="100%" height={140} />
                    <Skeleton width="100%" height={100} />
                </View>
            </View>
        );
    }

    if (isError || !employee) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Funcionário" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    const fullName = [employee.name, employee.last_name].filter(Boolean).join(' ');
    const list = movements?.items ?? [];

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader
                title={fullName}
                subtitle={employee.position ?? undefined}
                onBack={() => navigation.goBack()}
                right={statusBadge(employee)}
            />

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                <Card>
                    <Text className="mb-1 font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                        Dados
                    </Text>
                    <InfoRow label="Cargo" value={employee.position} />
                    <InfoRow label="Departamento" value={employee.department} />
                    <InfoRow label="Loja" value={employee.store_name} />
                    <InfoRow label="Telefone" value={employee.phone} />
                    <InfoRow label="E-mail" value={employee.email} />
                    <InfoRow
                        label="Admissão"
                        value={employee.entry_date ? formatDateBR(employee.entry_date) : null}
                    />
                    {employee.dismissal_date ? (
                        <InfoRow label="Demissão" value={formatDateBR(employee.dismissal_date)} />
                    ) : null}
                </Card>

                <Card className="mt-4">
                    <Text className="mb-2 font-sans-semibold text-sm text-neutral-500 dark:text-dark-text-muted">
                        Movimentações
                    </Text>
                    {movementsLoading ? (
                        <View className="gap-3 py-2">
                            <Skeleton width="100%" height={40} />
                            <Skeleton width="100%" height={40} />
                        </View>
                    ) : list.length === 0 ? (
                        <Text className="py-4 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
                            Nenhuma movimentação registrada.
                        </Text>
                    ) : (
                        list.map((m) => <MovementItem key={m.id} movement={m} />)
                    )}
                </Card>
            </ScrollView>
        </View>
    );
}
