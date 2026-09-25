import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { usersService } from '@/services/api/users.service';

interface UserComboboxProps {
    value: number | null;
    onChange: (userId: number | null) => void;
    currentUserLabel?: string | null;
    placeholder?: string;
    disabled?: boolean;
}

export function UserCombobox({
    value,
    onChange,
    currentUserLabel,
    placeholder = '— Sem vínculo —',
    disabled = false,
}: UserComboboxProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const { data } = useQuery({
        queryKey: ['users', 'selectable', 'available-for-link'],
        queryFn: () => usersService.listSelectable({ has_employee: false, is_active: true }, 1, 200),
        staleTime: 1000 * 30,
        enabled: open,
    });

    const users = data?.users ?? [];

    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            setSearch('');
        }
    }, [open]);

    const term = search.trim().toLowerCase();
    const filtered = term
        ? users.filter(
            (u) =>
                u.full_name.toLowerCase().includes(term) ||
                u.email.toLowerCase().includes(term)
        )
        : users;

    const selectedFromList = users.find((u) => u.id === value);
    const displayLabel = selectedFromList?.full_name ?? (value != null ? currentUserLabel : null);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    className={cn(
                        'w-full h-10 justify-between font-normal text-left overflow-hidden',
                        !displayLabel && 'text-muted-foreground'
                    )}
                >
                    <span className="truncate min-w-0">{displayLabel ?? placeholder}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="p-0 w-[calc(100vw-2rem)] sm:w-[380px]"
                align="start"
                side="bottom"
                avoidCollisions
            >
                <div className="p-2 border-b">
                    <Input
                        ref={inputRef}
                        placeholder="Buscar por nome ou e-mail..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 text-sm"
                    />
                </div>
                <div className="overflow-y-auto max-h-[300px]">
                    <button
                        type="button"
                        className={cn(
                            'w-full text-left px-3 py-2 text-sm hover:bg-accent',
                            value == null && 'bg-accent font-medium'
                        )}
                        onClick={() => { onChange(null); setOpen(false); }}
                    >
                        — Sem vínculo —
                    </button>

                    {value != null && currentUserLabel && !selectedFromList && (
                        <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm bg-accent font-medium"
                            onClick={() => setOpen(false)}
                        >
                            {currentUserLabel}
                        </button>
                    )}

                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                            Nenhum usuário disponível.
                        </div>
                    ) : (
                        filtered.map((u) => (
                            <button
                                key={u.id}
                                type="button"
                                className={cn(
                                    'w-full text-left px-3 py-2 text-sm hover:bg-accent',
                                    u.id === value && 'bg-accent font-medium'
                                )}
                                onClick={() => { onChange(u.id); setOpen(false); }}
                            >
                                <span className="block leading-tight">{u.full_name}</span>
                                <span className="block text-xs text-muted-foreground leading-tight">{u.email}</span>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
