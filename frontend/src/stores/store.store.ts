import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Store } from '@/services/api/stores.service';

interface StoreState {
    availableStores: Store[];
    selectedStoreId: number | null;
    isMultiStore: boolean;
    setAvailableStores: (stores: Store[]) => void;
    selectStore: (storeId: number | null) => void;  // null = "Todas as Lojas"
}

export const useStoreStore = create<StoreState>()(
    persist(
        (set, get) => ({
            availableStores: [],
            selectedStoreId: null,
            isMultiStore: false,

            setAvailableStores: (stores) => {
                const current = get().selectedStoreId;
                // Manter a seleção persistida se a loja ainda existe na lista
                const stillValid = current !== null && stores.some(s => s.id === current);

                set({
                    availableStores: stores,
                    isMultiStore: stores.length > 1,
                    selectedStoreId: stores.length === 1
                        ? stores[0].id
                        : stillValid
                            ? current
                            : null,
                });
            },

            selectStore: (storeId) => set({ selectedStoreId: storeId }),
        }),
        {
            name: 'aems-store-selection',
            partialize: (state) => ({
                selectedStoreId: state.selectedStoreId,
            }),
        }
    )
);
