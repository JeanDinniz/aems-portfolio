import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStores } from '@/hooks/useStores';
import { EMPLOYEE_POSITIONS, HR_STATUS_OPTIONS } from '@/constants/employees';
import type { EmployeeFilters as Filters } from '@/types/employee.types';

interface Props {
    filters: Filters;
    onFiltersChange: (filters: Filters) => void;
}

export function EmployeeFilters({ filters, onFiltersChange }: Props) {
    const { stores } = useStores();

    const handleChange = (key: keyof Filters, value: Filters[keyof Filters]) => {
        onFiltersChange({ ...filters, [key]: value !== 'all' ? value : undefined });
    };

    return (
        <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Buscar</span>
                <Input
                    placeholder="Buscar por nome"
                    value={filters.search || ''}
                    onChange={(e) => handleChange('search', e.target.value || undefined)}
                    className="max-w-xs bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                />
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Loja</span>
                <Select
                    value={filters.store_id?.toString() || 'all'}
                    onValueChange={(v) => handleChange('store_id', v === 'all' ? undefined : Number(v))}
                >
                    <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <SelectValue placeholder="Loja" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todas as lojas</SelectItem>
                        {stores?.map((store) => (
                            <SelectItem key={store.id} value={store.id.toString()} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                {store.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Cargo</span>
                <Select
                    value={filters.position || 'all'}
                    onValueChange={(v) => handleChange('position', v === 'all' ? undefined : v)}
                >
                    <SelectTrigger className="w-[200px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <SelectValue placeholder="Cargo" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todos os cargos</SelectItem>
                        {EMPLOYEE_POSITIONS.map((pos) => (
                            <SelectItem key={pos.value} value={pos.value} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                {pos.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Status</span>
                <Select
                    value={filters.hr_status || 'all'}
                    onValueChange={(v) => handleChange('hr_status', v === 'all' ? undefined : v as 'active' | 'away' | 'dismissed')}
                >
                    <SelectTrigger className="w-[160px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todos</SelectItem>
                        {HR_STATUS_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Vínculo</span>
                <Select
                    value={filters.has_user === true ? 'with' : filters.has_user === false ? 'without' : 'all'}
                    onValueChange={(v) =>
                        onFiltersChange({
                            ...filters,
                            has_user: v === 'with' ? true : v === 'without' ? false : undefined,
                        })
                    }
                >
                    <SelectTrigger className="w-[160px] bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <SelectValue placeholder="Vínculo" />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                        <SelectItem value="all" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Todos</SelectItem>
                        <SelectItem value="with" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Com usuário</SelectItem>
                        <SelectItem value="without" className="focus:bg-gray-100 dark:focus:bg-zinc-700 focus:text-[#111111] dark:focus:text-white">Sem usuário</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
