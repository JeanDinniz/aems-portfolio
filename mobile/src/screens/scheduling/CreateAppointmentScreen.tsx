import { ScrollView, View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { AppointmentFormFields } from '@/components/features/scheduling/AppointmentFormFields';
import { useCreateAppointment } from '@/hooks/useScheduling';
import type { CreateAppointmentPayload } from '@/types/scheduling.types';
import type { SchedulingStackScreenProps } from '@/navigation/types';

/**
 * AGD-03 — Novo Agendamento.
 *
 * Tela fina: cabeçalho + form compartilhado (AppointmentFormFields). O form
 * monta o payload e delega aqui via `onSubmit`; a mutation
 * (`useCreateAppointment`) cuida do toast de sucesso/erro e da invalidação em
 * cascata da lista. Ao concluir, volta para a lista.
 */
export function CreateAppointmentScreen({
    navigation,
}: SchedulingStackScreenProps<'CreateAppointment'>) {
    const createAppointment = useCreateAppointment();

    const handleSubmit = (payload: CreateAppointmentPayload) => {
        createAppointment.mutate(payload, {
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
                    submitting={createAppointment.isPending}
                />
            </ScrollView>
        </View>
    );
}
