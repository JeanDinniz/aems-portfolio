import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';

interface MultiSelectFilterProps<V extends string | number> {
    options: { value: V; label: string }[];
    value: V[];
    onChange: (next: V[]) => void;
    allLabel: string;
    countLabel: (n: number) => string;
    emptyMessage?: string;
    triggerClassName?: string;
    contentClassName?: string;
}

export function MultiSelectFilter<V extends string | number>({
    options,
    value,
    onChange,
    allLabel,
    countLabel,
    emptyMessage,
    triggerClassName = 'w-40',
    contentClassName = 'w-56',
}: MultiSelectFilterProps<V>) {
    const [open, setOpen] = useState(false);

    const label =
        value.length === 0
            ? allLabel
            : value.length === 1
                ? (options.find((o) => o.value === value[0])?.label ?? allLabel)
                : countLabel(value.length);

    const toggle = (v: V) =>
        onChange(value.includes(v) ? value.filter((s) => s !== v) : [...value, v]);

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex h-9 ${triggerClassName} items-center justify-between gap-2 rounded-lg border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] px-3 text-sm text-[#111111] dark:text-white cursor-pointer hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] focus:outline-none focus:ring-2 focus:ring-[#F5A800] focus:border-[#F5A800] transition-colors`}
                >
                    <span className="truncate">{label}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className={`${contentClassName} p-1 border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A]`}
            >
                {options.length === 0 && emptyMessage ? (
                    <div className="px-3 py-2 text-sm text-[#666666] dark:text-zinc-400">
                        {emptyMessage}
                    </div>
                ) : (
                    <>
                        <DropdownMenuCheckboxItem
                            checked={value.length === 0}
                            onSelect={(e) => { e.preventDefault(); onChange([]); }}
                            className="text-sm text-[#111111] dark:text-white focus:bg-[#F5F5F5] dark:focus:bg-[#2A2A2A] [&>span]:border-2 [&>span]:border-[#F5A800] [&>span]:rounded-sm"
                        >
                            {allLabel}
                        </DropdownMenuCheckboxItem>
                        {options.map((opt) => (
                            <DropdownMenuCheckboxItem
                                key={String(opt.value)}
                                checked={value.includes(opt.value)}
                                onSelect={(e) => { e.preventDefault(); toggle(opt.value); }}
                                className="text-sm text-[#111111] dark:text-white focus:bg-[#F5F5F5] dark:focus:bg-[#2A2A2A] [&>span]:border-2 [&>span]:border-[#F5A800] [&>span]:rounded-sm"
                            >
                                {opt.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
