import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { useStores } from '@/hooks/useStores';

/**
 * Seletor de loja global (AUTH-07). `null` = "Todas as Lojas".
 * Usa um Modal simples (o bottom-sheet do design system vem na DS-03).
 * Some quando o usuário só tem uma loja acessível.
 */
export function StoreSelector() {
    const { stores, selectedStoreId, isMultiStore, selectStore } = useStores();
    const [open, setOpen] = useState(false);

    if (!isMultiStore) {
        const only = stores[0];
        if (!only) return null;
        return (
            <View className="rounded-lg bg-neutral-800 px-3 py-2">
                <Text className="text-sm font-semibold text-neutral-100">{only.name}</Text>
            </View>
        );
    }

    const selected = stores.find((s) => s.id === selectedStoreId);
    const label = selected ? selected.name : 'Todas as Lojas';

    const pick = (id: number | null) => {
        selectStore(id);
        setOpen(false);
    };

    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Loja selecionada: ${label}`}
                onPress={() => setOpen(true)}
                className="flex-row items-center rounded-lg bg-neutral-800 px-3 py-2 active:opacity-80"
            >
                <Text className="mr-1 text-sm font-semibold text-neutral-100">{label}</Text>
                <Text className="text-xs text-brand">▾</Text>
            </Pressable>

            <Modal
                visible={open}
                transparent
                animationType="fade"
                onRequestClose={() => setOpen(false)}
            >
                <Pressable
                    className="flex-1 justify-end bg-black/50"
                    onPress={() => setOpen(false)}
                >
                    <Pressable className="rounded-t-2xl bg-white px-4 pb-8 pt-3" onPress={() => {}}>
                        <View className="mb-2 h-1 w-10 self-center rounded-full bg-neutral-200" />
                        <Text className="mb-2 px-1 text-base font-bold text-neutral-900">
                            Selecionar loja
                        </Text>

                        <StoreRow
                            label="Todas as Lojas"
                            active={selectedStoreId === null}
                            onPress={() => pick(null)}
                        />
                        {stores.map((s) => (
                            <StoreRow
                                key={s.id}
                                label={s.name}
                                active={selectedStoreId === s.id}
                                onPress={() => pick(s.id)}
                            />
                        ))}
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

function StoreRow({
    label,
    active,
    onPress,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={onPress}
            className="flex-row items-center justify-between border-b border-neutral-100 px-1 py-3.5 active:opacity-70"
        >
            <Text
                className={`text-base ${active ? 'font-bold text-primary-600' : 'text-neutral-700'}`}
            >
                {label}
            </Text>
            {active ? <Text className="text-base text-primary-600">✓</Text> : null}
        </Pressable>
    );
}
