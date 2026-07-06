import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

/**
 * Cabeçalho preto padrão das telas internas (doc 06 §11.2).
 *
 * Estrutura: botão voltar opcional · título + subtítulo · slot de ação à direita
 * (ex.: botão de filtro). Reaproveitado por listas, detalhe e placeholders para
 * manter a identidade visual consistente.
 */
export interface ScreenHeaderProps {
    title: string;
    subtitle?: string;
    onBack?: () => void;
    /** Ação(ões) à direita (ex.: botão de filtro). */
    right?: ReactNode;
}

export function ScreenHeader({ title, subtitle, onBack, right }: ScreenHeaderProps) {
    return (
        <SafeAreaView edges={['top']} className="bg-brand-black">
            <View className="flex-row items-center gap-3 px-4 pb-4 pt-2">
                {onBack ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Voltar"
                        onPress={onBack}
                        className="h-11 w-11 items-center justify-center rounded-full bg-white/10 active:opacity-70"
                    >
                        <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                    </Pressable>
                ) : null}

                <View className="flex-1">
                    <Text className="font-display-bold text-xl text-white" numberOfLines={1}>
                        {title}
                    </Text>
                    {subtitle ? (
                        <Text className="mt-0.5 font-sans text-sm text-neutral-400" numberOfLines={1}>
                            {subtitle}
                        </Text>
                    ) : null}
                </View>

                {right ? <View className="flex-row items-center gap-2">{right}</View> : null}
            </View>
        </SafeAreaView>
    );
}
