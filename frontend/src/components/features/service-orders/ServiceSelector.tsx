import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { UseFormReturn, FieldValues, Path } from 'react-hook-form';

interface Service {
    id: number;
    name: string;
    code?: string | null;
    base_price: number;
}

interface ServiceSelectorProps<T extends FieldValues = FieldValues> {
    form: UseFormReturn<T>;
    services: Service[] | undefined;
    isLoading: boolean;
    selectedBrand?: string;
    emptyMessage?: string;
}

export function ServiceSelector<T extends FieldValues = FieldValues>({
    form,
    services,
    isLoading,
    selectedBrand: _selectedBrand,
    emptyMessage = 'Nenhum serviço encontrado para esta loja.',
}: ServiceSelectorProps<T>) {
    const [search, setSearch] = useState('');

    return (
        <FormField
            control={form.control}
            name={'selected_services' as Path<T>}
            render={({ field }) => {
                const term = search.trim().toLowerCase();
                const filtered = term
                    ? (services ?? []).filter(
                          (s) =>
                              s.code?.toLowerCase().includes(term) ||
                              s.name.toLowerCase().includes(term)
                      )
                    : (services ?? []);

                return (
                <FormItem>
                    <FormLabel>Serviços Realizados <span className="text-aems-error">*</span></FormLabel>
                    <FormControl>
                        <Popover onOpenChange={(open) => { if (!open) setSearch(''); }}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn(
                                        'w-full justify-between h-auto min-h-[44px]',
                                        !field.value?.length && 'text-muted-foreground'
                                    )}
                                >
                                    {field.value?.length > 0
                                        ? `${field.value.length} serviço(s) selecionado(s)`
                                        : 'Selecione os serviços...'}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[520px] p-0" align="start">
                                <div className="p-2 border-b flex items-center justify-between gap-2">
                                    <Input
                                        placeholder="Buscar por código ou nome..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="h-8 text-sm"
                                    />
                                    {field.value?.length > 0 && (
                                        <span className="text-xs text-primary font-medium shrink-0">{field.value.length} sel.</span>
                                    )}
                                </div>
                                {isLoading ? (
                                    <div className="p-4 text-center text-sm text-muted-foreground">Carregando serviços...</div>
                                ) : !filtered.length ? (
                                    <div className="p-4 text-center text-sm text-muted-foreground">{term ? 'Nenhum resultado.' : emptyMessage}</div>
                                ) : (
                                    <ScrollArea className="h-[280px]">
                                        <div className="p-1">
                                            {filtered.map((service) => (
                                                <div
                                                    key={service.id}
                                                    className="flex items-center space-x-2 p-2 hover:bg-accent rounded-sm cursor-pointer"
                                                    onClick={() => {
                                                        const current: number[] = (field.value as number[]) || [];
                                                        const isSelected = current.includes(service.id);
                                                        field.onChange(isSelected
                                                            ? current.filter((id: number) => id !== service.id)
                                                            : [...current, service.id]
                                                        );
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            const current: number[] = (field.value as number[]) || [];
                                                            const isSelected = current.includes(service.id);
                                                            field.onChange(isSelected
                                                                ? current.filter((id: number) => id !== service.id)
                                                                : [...current, service.id]
                                                            );
                                                        }
                                                    }}
                                                    role="checkbox"
                                                    aria-checked={field.value?.includes(service.id) ?? false}
                                                    tabIndex={0}
                                                >
                                                    <div className={cn(
                                                        'flex h-4 w-4 items-center justify-center rounded-sm border border-primary shrink-0',
                                                        field.value?.includes(service.id) ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible'
                                                    )}>
                                                        <Check className="h-4 w-4" />
                                                    </div>
                                                    <div className="flex items-center justify-between flex-1 min-w-0">
                                                        <span className="text-sm truncate">{service.code ? `${service.code} - ${service.name}` : service.name}</span>
                                                        <span className="text-xs text-muted-foreground ml-2 shrink-0">R$ {Number(service.base_price).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                )}
                            </PopoverContent>
                        </Popover>
                    </FormControl>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {field.value?.map((serviceId: number) => {
                            const service = services?.find((s) => s.id === serviceId);
                            return service ? (
                                <Badge key={serviceId} variant="secondary" className="text-xs">
                                    {service.code ? `${service.code} - ${service.name}` : service.name}
                                </Badge>
                            ) : null;
                        })}
                    </div>
                    <FormMessage />
                </FormItem>
                )
            }}
        />
    );
}
