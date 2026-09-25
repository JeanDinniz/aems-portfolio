import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import type { AppStackScreenProps } from '@/navigation/types';
import { ToolPendingTab } from './ToolPendingTab';
import { ToolReceivedTab } from './ToolReceivedTab';
import { PendenciasTab } from './PendenciasTab';
import { EpiCatalogTab } from './EpiCatalogTab';
import { CargoMapTab } from './CargoMapTab';

/**
 * Controle de EPIs (mobile) — paridade com a web `EpiPage` (rota /admin/epi).
 *
 * Cinco abas: Pendências (cards de ferramentas a assinar), Recebimentos
 * (histórico de recebimentos de ferramentas, com comprovante), EPIs (relatório
 * pendente/vencido/em dia de EPIs), Catálogo (EPIs) e Cargos (mapeamento). O
 * recebimento de ferramentas exige assinatura + 1 foto por item.
 *
 * Header preto próprio (o AppStack usa `headerShown: false`).
 */

type TabKey = 'pendencias' | 'recebimentos' | 'epis' | 'catalogo' | 'cargos';

const TABS: { key: TabKey; label: string }[] = [
    { key: 'pendencias', label: 'Pendências' },
    { key: 'recebimentos', label: 'Recebimentos' },
    { key: 'epis', label: 'EPIs' },
    { key: 'catalogo', label: 'Catálogo' },
    { key: 'cargos', label: 'Cargos' },
];

export function EpiScreen({ navigation }: AppStackScreenProps<'Epi'>) {
    const [tab, setTab] = useState<TabKey>('pendencias');

    return (
        <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
            <SafeAreaView edges={['top']} className="bg-brand-black">
                <View className="flex-row items-center gap-3 px-4 pb-2 pt-2">
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Voltar"
                        onPress={() => navigation.goBack()}
                        hitSlop={8}
                        className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
                    >
                        <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                    </Pressable>
                    <View className="flex-1">
                        <Text className="font-display-bold text-xl text-white">Controle de EPIs</Text>
                        <Text className="mt-0.5 font-sans text-sm text-neutral-400">
                            Ficha de entrega, cargos e pendências
                        </Text>
                    </View>
                </View>

                {/* Tabs */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, gap: 8 }}
                >
                    {TABS.map((t) => {
                        const active = t.key === tab;
                        return (
                            <Pressable
                                key={t.key}
                                accessibilityRole="tab"
                                accessibilityState={{ selected: active }}
                                onPress={() => setTab(t.key)}
                                className={`min-h-[36px] justify-center rounded-full px-4 ${
                                    active ? 'bg-white' : 'bg-white/10 active:bg-white/20'
                                }`}
                            >
                                <Text
                                    className={`font-sans-semibold text-sm ${
                                        active ? 'text-brand-black' : 'text-neutral-300'
                                    }`}
                                >
                                    {t.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </SafeAreaView>

            <View className="flex-1">
                {tab === 'pendencias' ? (
                    <ToolPendingTab />
                ) : tab === 'recebimentos' ? (
                    <ToolReceivedTab navigation={navigation} />
                ) : tab === 'epis' ? (
                    <PendenciasTab />
                ) : tab === 'catalogo' ? (
                    <EpiCatalogTab />
                ) : (
                    <CargoMapTab />
                )}
            </View>
        </View>
    );
}
