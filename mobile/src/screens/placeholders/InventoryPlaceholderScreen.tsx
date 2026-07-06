import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import type { AppTabScreenProps } from '@/navigation/types';

/**
 * Placeholder da aba Estoque (Sprint 5). Mantém o header preto padrão e um
 * EmptyState "Em breve". A tela real chega no INV-* (Sprint 5).
 */
export function InventoryPlaceholderScreen(_props: AppTabScreenProps<'Inventory'>) {
    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <ScreenHeader title="Estoque" subtitle="Módulo em construção" />
            <SafeAreaView edges={['bottom']} className="flex-1">
                <EmptyState
                    icon="cube-outline"
                    title="Em breve"
                    description="A gestão de bobinas chega em uma próxima atualização."
                />
            </SafeAreaView>
        </View>
    );
}
