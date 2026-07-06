import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ConsultantFilters as Filters } from '@/types/consultant.types';
import { useStores } from '@/hooks/useStores';

interface ConsultantFiltersProps {
    filters: Filters;
    onFiltersChange: (filters: Filters) => void;
}

export function ConsultantFilters({ filters, onFiltersChange }: ConsultantFiltersProps) {
    const { stores } = useStores();

    const handleChange = (key: keyof Filters, value: Filters[keyof Filters]) => {
        onFiltersChange({ ...filters, [key]: value !== 'all' ? value : undefined });
    };

    return (
        <div className="flex flex-col md:flex-row gap-4">
            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Buscar</span>
                <Input
                    placeholder="Buscar por nome"
                    value={filters.search || ''}
                    onChange={(e) => handleChange('search', e.target.value)}
                    className="max-w-xs bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                />
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Loja</span>
                <Select
                    value={filters.store_id?.toString() || 'all'}
                    onValueChange={(value) => handleChange('store_id', value === 'all' ? undefined : Number(value))}
                >
                    <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <SelectValue placeholder="Loja" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todas as lojas</SelectItem>
                        {stores?.map((store) => (
                            <SelectItem key={store.id} value={store.id.toString()} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                {store.code} - {store.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Status</span>
                <Select
                    value={filters.is_active === undefined ? 'all' : filters.is_active ? 'true' : 'false'}
                    onValueChange={(value) => handleChange('is_active', value === 'all' ? undefined : value === 'true')}
                >
                    <SelectTrigger className="w-[180px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todos os status</SelectItem>
                        <SelectItem value="true" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Ativo</SelectItem>
                        <SelectItem value="false" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Inativo</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
