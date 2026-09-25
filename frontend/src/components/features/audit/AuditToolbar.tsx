import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { AUDIT_ACTION_LABELS, AUDIT_RESOURCE_LABELS } from '@/constants/audit';
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from '@/types/audit';
import type { AuditLogFilters } from '@/types/audit';

interface AuditToolbarProps {
    filters: AuditLogFilters;
    onChange: (filters: AuditLogFilters) => void;
}

export function AuditToolbar({ filters, onChange }: AuditToolbarProps) {
    const hasFilters =
        !!filters.action ||
        !!filters.resource_type ||
        filters.resource_id !== undefined ||
        !!filters.user_name ||
        !!filters.start_date ||
        !!filters.end_date;

    function update(patch: Partial<AuditLogFilters>) {
        onChange({ ...filters, ...patch, page: 1 });
    }

    function clear() {
        onChange({});
    }

    return (
        <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap gap-4 items-end">
            {/* Ação */}
            <div className="flex flex-col gap-1 min-w-[180px]">
                <Label className="text-xs">Ação</Label>
                <Select
                    value={filters.action ?? '__all__'}
                    onValueChange={(v) => update({ action: v === '__all__' ? undefined : v })}
                >
                    <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Todas as ações" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">Todas as ações</SelectItem>
                        {AUDIT_ACTIONS.map((a) => (
                            <SelectItem key={a} value={a}>
                                {AUDIT_ACTION_LABELS[a] ?? a}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Tipo de entidade */}
            <div className="flex flex-col gap-1 min-w-[180px]">
                <Label className="text-xs">Tipo de Entidade</Label>
                <Select
                    value={filters.resource_type ?? '__all__'}
                    onValueChange={(v) => update({ resource_type: v === '__all__' ? undefined : v })}
                >
                    <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Todos os tipos" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">Todos os tipos</SelectItem>
                        {AUDIT_RESOURCE_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                                {AUDIT_RESOURCE_LABELS[t] ?? t}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Usuário */}
            <div className="flex flex-col gap-1 min-w-[180px]">
                <Label className="text-xs">Usuário</Label>
                <Input
                    type="text"
                    placeholder="Nome do usuário"
                    className="h-9 text-sm"
                    value={filters.user_name ?? ''}
                    onChange={(e) => update({ user_name: e.target.value || undefined })}
                />
            </div>

            {/* ID do recurso */}
            <div className="flex flex-col gap-1 w-32">
                <Label className="text-xs">ID do Recurso</Label>
                <Input
                    type="number"
                    placeholder="ID"
                    className="h-9 text-sm"
                    value={filters.resource_id ?? ''}
                    onChange={(e) =>
                        update({
                            resource_id: e.target.value ? Number(e.target.value) : undefined,
                        })
                    }
                />
            </div>

            {/* Início */}
            <div className="flex flex-col gap-1">
                <Label className="text-xs">Início</Label>
                <Input
                    type="datetime-local"
                    className="h-9 text-sm"
                    value={filters.start_date ?? ''}
                    onChange={(e) => update({ start_date: e.target.value || undefined })}
                />
            </div>

            {/* Fim */}
            <div className="flex flex-col gap-1">
                <Label className="text-xs">Fim</Label>
                <Input
                    type="datetime-local"
                    className="h-9 text-sm"
                    value={filters.end_date ?? ''}
                    onChange={(e) => update({ end_date: e.target.value || undefined })}
                />
            </div>

            {/* Limpar */}
            {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clear} className="h-9 gap-1">
                    <X className="h-4 w-4" />
                    Limpar
                </Button>
            )}
        </div>
    );
}
