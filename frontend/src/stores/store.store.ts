import { create } from 'zustand';
import type { Store } from '@/services/api/stores.service';

// Guarda apenas a LISTA de lojas acessíveis ao usuário (usada para popular
// dropdowns de "Loja" nas telas). A antiga "loja selecionada" global foi
// removida — cada tela tem seu próprio filtro de loja local. A lista é
// repovoada a cada carregamento por useStores(), então não é persistida.
interface StoreState {
    availableStores: Store[];
    setAvailableStores: (stores: Store[]) => void;
}

export const useStoreStore = create<StoreState>()((set) => ({
    availableStores: [],
    setAvailableStores: (stores) => set({ availableStores: stores }),
}));
