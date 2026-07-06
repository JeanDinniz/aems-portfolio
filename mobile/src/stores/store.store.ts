import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Store } from '@/services/api/stores.service';
import { useSettingsStore } from '@/stores/settings.store';

/**
 * Store de seleção de loja (DATA-04) — portado de
 * frontend/src/stores/store.store.ts. `selectedStoreId = null` → "Todas as Lojas".
 * Só `selectedStoreId` é persistido (AsyncStorage).
 */
interface StoreState {
    availableStores: Store[];
    selectedStoreId: number | null;
    isMultiStore: boolean;
    setAvailableStores: (stores: Store[]) => void;
    selectStore: (storeId: number | null) => void;
}

export const useStoreStore = create<StoreState>()(
    persist(
        (set, get) => ({
            availableStores: [],
            selectedStoreId: null,
            isMultiStore: false,

            setAvailableStores: (stores) => {
                const current = get().selectedStoreId;
                // Mantém a seleção persistida se a loja ainda existe na lista.
                const stillValid = current !== null && stores.some((s) => s.id === current);

                // Loja padrão (HARD-04): se não há seleção explícita válida e o
                // usuário definiu um `defaultStoreId` que existe na lista, aplica-o.
                // Não sobrescreve uma seleção já válida (ex.: escolha manual desta
                // sessão) nem o caso de loja única (que sempre fixa a única).
                const defaultStoreId = useSettingsStore.getState().defaultStoreId;
                const defaultValid =
                    defaultStoreId !== null && stores.some((s) => s.id === defaultStoreId);

                let nextSelected: number | null;
                if (stores.length === 1) {
                    nextSelected = stores[0].id;
                } else if (stillValid) {
                    nextSelected = current;
                } else if (defaultValid) {
                    nextSelected = defaultStoreId;
                } else {
                    nextSelected = null;
                }

                set({
                    availableStores: stores,
                    isMultiStore: stores.length > 1,
                    selectedStoreId: nextSelected,
                });
            },

            selectStore: (storeId) => set({ selectedStoreId: storeId }),
        }),
        {
            name: 'aems-store-selection',
            storage: createJSONStorage(() => AsyncStorage),
            partialize: (state) => ({
                selectedStoreId: state.selectedStoreId,
            }),
        }
    )
);
