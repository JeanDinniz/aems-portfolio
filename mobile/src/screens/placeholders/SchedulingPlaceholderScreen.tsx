import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import type { AppTabScreenProps } from '@/navigation/types';

/**
 * Placeholder da aba Agendamentos (Sprint 4). Mantém o header preto padrão e um
 * EmptyState "Em breve". A tela real chega no SCH-* (Sprint 4).
 */
export function SchedulingPlaceholderScreen(_props: AppTabScreenProps<'Scheduling'>) {
    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Agendamentos" subtitle="Módulo em construção" />
            <SafeAreaView edges={['bottom']} className="flex-1">
                <EmptyState
                    icon="calendar-outline"
                    title="Em breve"
                    description="Os agendamentos chegam em uma próxima atualização."
                />
            </SafeAreaView>
        </View>
    );
}
