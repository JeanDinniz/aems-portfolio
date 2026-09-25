import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { usePendencias } from '@/hooks/useEpi';
import type { PendenciaEstado } from '@/types/epi.types';

const ALL = '__all__';

const ESTADO_LABEL: Record<PendenciaEstado, string> = {
    PENDENTE: 'Pendente', VENCIDO: 'Vencido', EM_DIA: 'Em dia',
};
const ESTADO_CLASS: Record<PendenciaEstado, string> = {
    VENCIDO: 'bg-red-100 text-red-700 border-red-200',
    PENDENTE: 'bg-amber-100 text-amber-700 border-amber-200',
    EM_DIA: 'bg-green-100 text-green-700 border-green-200',
};

function fmt(d: string | null): string {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
}

export function PendenciasTab() {
    const [estado, setEstado] = useState<string>(ALL);
    const { data, isLoading } = usePendencias(estado === ALL ? undefined : (estado as PendenciaEstado));
    const items = data?.items ?? [];

    return (
        <div className="space-y-4 pt-4">
            <div className="w-64">
                <Select value={estado} onValueChange={setEstado}>
                    <SelectTrigger><SelectValue placeholder="Filtrar por estado" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>Todos</SelectItem>
                        <SelectItem value="VENCIDO">Vencido</SelectItem>
                        <SelectItem value="PENDENTE">Pendente</SelectItem>
                        <SelectItem value="EM_DIA">Em dia</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : items.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma pendência para os filtros atuais.</p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <div className="grid min-w-[820px] grid-cols-[1.4fr_1fr_1fr_1.2fr_110px_110px_90px] gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium">
                        <span>Funcionário</span><span>Loja</span><span>Cargo</span><span>EPI</span>
                        <span>Vencimento</span><span>Estado</span><span>Dias</span>
                    </div>
                    {items.map((it) => (
                        <div key={`${it.employee_id}-${it.epi_id}`} className="grid min-w-[820px] grid-cols-[1.4fr_1fr_1fr_1.2fr_110px_110px_90px] items-center gap-2 border-b px-4 py-2 text-sm last:border-0">
                            <span>{it.employee_name}</span>
                            <span className="text-muted-foreground">{it.store_name ?? '—'}</span>
                            <span className="text-muted-foreground">{it.cargo}</span>
                            <span>{it.epi_name}</span>
                            <span>{fmt(it.data_vencimento)}</span>
                            <span><Badge variant="outline" className={ESTADO_CLASS[it.estado]}>{ESTADO_LABEL[it.estado]}</Badge></span>
                            <span className={it.estado === 'VENCIDO' ? 'text-red-600' : ''}>
                                {it.dias_restantes === null ? '—' : it.dias_restantes}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
