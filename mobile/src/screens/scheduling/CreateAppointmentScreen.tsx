import { ScrollView, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { AppointmentFormFields } from '@/components/features/scheduling/AppointmentFormFields';
import { useCreateAppointment, useCreateCombinedAppointment } from '@/hooks/useScheduling';
import type {
    CombinedAppointmentPayload,
    CreateAppointmentPayload,
} from '@/types/scheduling.types';
import type { SchedulingStackScreenProps } from '@/navigation/types';

/**
 * AGD-03 — Novo Agendamento.
 *
 * Tela fina: cabeçalho + form compartilhado (AppointmentFormFields). O form
 * monta o payload e delega aqui via `onSubmit` (1 depto) ou `onSubmitCombined`
 * (múltiplos departamentos → POST /scheduling/combined); as mutations
 * (`useCreateAppointment` / `useCreateCombinedAppointment`) cuidam do toast de
 * sucesso/erro e da invalidação em cascata da lista. Ao concluir, volta.
 */
export function CreateAppointmentScreen({
    navigation,
}: SchedulingStackScreenProps<'CreateAppointment'>) {
    const createAppointment = useCreateAppointment();
    const createCombined = useCreateCombinedAppointment();

    const handleSubmit = (payload: CreateAppointmentPayload) => {
        createAppointment.mutate(payload, {
            onSuccess: () => navigation.goBack(),
        });
    };

    const handleSubmitCombined = (payload: CombinedAppointmentPayload) => {
        createCombined.mutate(payload, {
            onSuccess: () => navigation.goBack(),
        });
    };

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Novo Agendamento" onBack={() => navigation.goBack()} />
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="interactive"
            >
                <AppointmentFormFields
                    mode="create"
                    onSubmit={handleSubmit}
                    onSubmitCombined={handleSubmitCombined}
                    submitting={createAppointment.isPending || createCombined.isPending}
                />
            </ScrollView>
        </View>
    );
}
