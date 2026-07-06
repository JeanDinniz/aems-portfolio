import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "@/components/ui/select";
import { useStores } from "@/hooks/useStores";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Store as StoreIcon } from "lucide-react";

export function StoreSelector() {
    const { stores, selectedStoreId, selectStore, isMultiStore } = useStores();
    const queryClient = useQueryClient();

    if (!isMultiStore) return null;

    const handleValueChange = (value: string) => {
        const id = value === "all" ? null : Number(value);
        selectStore(id);

        // Invalidate queries that depend on store context
        queryClient.invalidateQueries({ queryKey: ['service-orders'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    };

    const selectedStore = stores.find(s => s.id === selectedStoreId);
    const currentValue = selectedStoreId === null ? "all" : selectedStoreId.toString();

    return (
        <div className="flex items-center w-full">
            <Select value={currentValue} onValueChange={handleValueChange}>
                <SelectTrigger className="w-full h-9 border-[#D1D1D1] dark:border-[#2A2A2A]">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span className="truncate text-foreground font-medium">
                            {selectedStoreId === null ? "Todas as Lojas" : selectedStore?.name}
                        </span>
                    </div>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">
                        <div className="flex items-center gap-2">
                            <StoreIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">Todas as Lojas</span>
                        </div>
                    </SelectItem>
                    {stores.map((store) => (
                        <SelectItem key={store.id} value={store.id.toString()}>
                            {store.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
