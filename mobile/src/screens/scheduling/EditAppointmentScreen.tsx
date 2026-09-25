import { ScrollView, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { AppointmentFormFields } from '@/components/features/scheduling/AppointmentFormFields';
import { useAppointment, useUpdateAppointment, useAddDepartments } from '@/hooks/useScheduling';
import type {
    CombinedDepartmentEntry,
    CreateAppointmentPayload,
} from '@/types/scheduling.types';
import type { SchedulingStackScreenProps } from '@/navigation/types';

/**
 * AGD-04 (parte de edição) — Editar Agendamento.
 *
 * Carrega o agendamento (`useAppointment`) e reusa o MESMO form do Create
 * (AppointmentFormFields) em modo `edit` — que popula os campos a partir do
 * registro. PATCH parcial via `useUpdateAppointment`.
 *
 * Regra crítica (diferente da O.S.): no modo `edit`, o usuário galpão PODE
 * desmarcar `is_galpon` — o tratamento fica no AppointmentFormFields
 * (lockGalponToggle só vale no create).
 */
export function EditAppointmentScreen({
    route,
    navigation,
}: SchedulingStackScreenProps<'EditAppointment'>) {
    const { id } = route.params;
    const { data: appointment, isLoading, isError, refetch } = useAppointment(id);
    const updateAppointment = useUpdateAppointment();
    const addDepartments = useAddDepartments();

    const handleSubmit = (payload: CreateAppointmentPayload) => {
        // PATCH parcial — UpdateAppointmentPayload é Partial<Create>.
        updateAppointment.mutate(
            { id, payload },
            { onSuccess: () => navigation.goBack() }
        );
    };

    // Edição combinada: 1) atualiza o atual; 2) cria os irmãos (herdam os dados
    // já atualizados); 3) volta. Sem departamentos novos = edição normal.
    const handleSubmitEditCombined = (
        updatePayload: CreateAppointmentPayload,
        newDepartments: CombinedDepartmentEntry[]
    ) => {
        updateAppointment.mutate(
            { id, payload: updatePayload },
            {
                onSuccess: () => {
                    if (newDepartments.length === 0) {
                        navigation.goBack();
                        return;
                    }
                    addDepartments.mutate(
                        { id, payload: { departments: newDepartments } },
                        { onSuccess: () => navigation.goBack() }
                    );
                },
            }
        );
    };

    if (isLoading) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Carregando..." onBack={() => navigation.goBack()} />
                <View className="gap-3 p-4">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} width="100%" height={52} />
                    ))}
                </View>
            </View>
        );
    }

    if (isError || !appointment) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Editar Agendamento" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Editar Agendamento" onBack={() => navigation.goBack()} />
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="interactive"
            >
                <AppointmentFormFields
                    mode="edit"
                    appointment={appointment}
                    onSubmit={handleSubmit}
                    onSubmitEditCombined={handleSubmitEditCombined}
                    submitting={updateAppointment.isPending || addDepartments.isPending}
                />
            </ScrollView>
        </View>
    );
}
