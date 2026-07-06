import { useState } from 'react';
import { ChevronRight, ChevronDown, ShieldCheck } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AuditActionBadge } from './AuditActionBadge';
import type { AuditLog } from '@/types/audit';

// ─── Label maps ──────────────────────────────────────────────────────────────

const RESOURCE_LABELS: Record<string, string> = {
    auth:           'Autenticação',
    user:           'Usuário',
    employee:       'Funcionário',
    consultant:     'Consultor',
    service_order:  'Ordem de Serviço',
    store:          'Loja',
    access_profile: 'Perfil de Acesso',
    film_type:      'Tipo de Película',
    film_roll:      'Bobina',
    appointment:    'Agendamento',
    service:        'Serviço',
    brand:          'Marca',
    vehicle_model:  'Modelo de Veículo',
};

const FIELD_LABELS: Record<string, string> = {
    plate:                          'Placa',
    vehicle_plate:                  'Placa',
    department:                     'Departamento',
    store_id:                       'Loja',
    is_galpon:                      'Galpão',
    is_return:                      'Retorno',
    is_courtesy:                    'Cortesia',
    status:                         'Status',
    consultant_id:                  'Consultor',
    consultant_name:                'Nome do Consultor',
    vehicle_model:                  'Modelo',
    vehicle_model_id:               'Modelo do Veículo',
    vehicle_color:                  'Cor',
    vehicle_brand:                  'Marca',
    vehicle_year:                   'Ano',
    external_os_number:             'Nº OS Externa',
    service_date:                   'Data do Serviço',
    items:                          'Serviços',
    name:                           'Nome',
    email:                          'E-mail',
    role:                           'Perfil',
    is_active:                      'Ativo',
    remaining_meters:               'Metros Restantes',
    total_meters:                   'Total de Metros',
    delivery_date:                  'Data do Serviço',
    notes:                          'Observações',
    internal_notes:                 'Notas Internas',
    is_verified:                    'Verificado',
    code:                           'Código',
    address:                        'Endereço',
    phone:                          'Telefone',
    brand_id:                       'Marca',
    permissions_updated:            'Permissões',
    must_change_password:           'Trocar Senha',
    failed_login_attempts_cleared:  'Tentativas Resetadas',
    invoice_number:                 'Nº Nota Fiscal',
    requires_invoice:               'Requer NF',
    film_type_id:                   'Tipo de Película',
};

const DEPT_LABELS: Record<string, string> = {
    film:       'Película',
    ppf:        'PPF',
    bodywork:   'Funilaria',
    vn:         'Veículos Novos',
    vd:         'Venda Direta',
    vu:         'Veículos Usados',
    workshop:   'Oficina',
};

const STATUS_LABELS: Record<string, string> = {
    waiting:     'Aguardando',
    in_progress: 'Em Andamento',
    completed:   'Finalizado',
    cancelled:   'Cancelado',
    wrong:       'Lançado Errado',
    em_estoque:  'Em Estoque',
    em_uso:      'Em Uso',
    esgotada:    'Esgotada',
};

const ROLE_LABELS: Record<string, string> = {
    owner: 'Proprietário',
    user:  'Usuário',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
        day:    '2-digit',
        month:  '2-digit',
        year:   'numeric',
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(iso));
}

interface Resolvers {
    storeMap?: Record<number, string>;
    filmTypeMap?: Record<number, string>;
}

function formatValue(key: string, value: unknown, resolvers?: Resolvers): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
    if (key === 'department') return DEPT_LABELS[String(value)] ?? String(value);
    if (key === 'status') return STATUS_LABELS[String(value)] ?? String(value);
    if (key === 'role') return ROLE_LABELS[String(value)] ?? String(value);
    if (key === 'store_id' && typeof value === 'number' && resolvers?.storeMap) {
        return resolvers.storeMap[value] ?? `Loja #${value}`;
    }
    if (key === 'film_type_id' && typeof value === 'number' && resolvers?.filmTypeMap) {
        return resolvers.filmTypeMap[value] ?? `#${value}`;
    }
    if (key === 'items' && Array.isArray(value)) return `${(value as unknown[]).length} item(s)`;
    if (Array.isArray(value)) return `${(value as unknown[]).length} registro(s)`;
    if (typeof value === 'object') return '(objeto)';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-');
        return `${d}/${m}/${y}`;
    }
    return String(value);
}

// Chaves que são sinônimos — mapeadas para a chave canônica
const KEY_ALIASES: Record<string, string> = {
    plate: 'vehicle_plate',
};

function normalizeKey(key: string): string {
    return KEY_ALIASES[key] ?? key;
}

function getValueForKey(obj: Record<string, unknown>, canonicalKey: string): unknown {
    if (canonicalKey in obj) return obj[canonicalKey];
    for (const [alias, canonical] of Object.entries(KEY_ALIASES)) {
        if (canonical === canonicalKey && alias in obj) return obj[alias];
    }
    return undefined;
}

function fieldLabel(key: string): string {
    return FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
}

// ─── Diff components ──────────────────────────────────────────────────────────

/** Update or status_change: three-column diff table (Campo | Antes | Depois) */
function DiffTable({
    oldValue,
    newValue,
    resolvers,
}: {
    oldValue: Record<string, unknown>;
    newValue: Record<string, unknown>;
    resolvers?: Resolvers;
}) {
    const keys = Array.from(new Set([
        ...Object.keys(oldValue).map(normalizeKey),
        ...Object.keys(newValue).map(normalizeKey),
    ]));

    return (
        <table className="w-full text-xs border-collapse">
            <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1 pr-3 font-medium w-1/3">Campo</th>
                    <th className="py-1 pr-3 font-medium w-1/3">Antes</th>
                    <th className="py-1 font-medium w-1/3">Depois</th>
                </tr>
            </thead>
            <tbody>
                {keys.map((key) => {
                    const before = formatValue(key, getValueForKey(oldValue, key), resolvers);
                    const after  = formatValue(key, getValueForKey(newValue, key), resolvers);
                    const changed = before !== after;
                    return (
                        <tr
                            key={key}
                            className={cn(
                                'border-b border-border/50 last:border-0',
                                changed && 'bg-amber-50 dark:bg-amber-950/30'
                            )}
                        >
                            <td className="py-1 pr-3 font-medium text-foreground/70">{fieldLabel(key)}</td>
                            <td className={cn('py-1 pr-3', changed && 'text-red-600 dark:text-red-400')}>
                                {before}
                            </td>
                            <td className={cn('py-1', changed && 'text-green-700 dark:text-green-400 font-medium')}>
                                {after}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

/** Create: two-column table (Campo | Valor) */
function CreateTable({ value, resolvers }: { value: Record<string, unknown>; resolvers?: Resolvers }) {
    const keys = Object.keys(value);
    return (
        <table className="w-full text-xs border-collapse">
            <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1 pr-3 font-medium w-1/3">Campo</th>
                    <th className="py-1 font-medium">Valor</th>
                </tr>
            </thead>
            <tbody>
                {keys.map((key) => (
                    <tr key={key} className="border-b border-border/50 last:border-0">
                        <td className="py-1 pr-3 font-medium text-foreground/70">{fieldLabel(key)}</td>
                        <td className="py-1 text-foreground">{formatValue(key, value[key], resolvers)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Delete: two-column table (Campo | Valor removido) with red-tinted text */
function DeleteTable({ value, resolvers }: { value: Record<string, unknown>; resolvers?: Resolvers }) {
    const keys = Object.keys(value);
    return (
        <table className="w-full text-xs border-collapse">
            <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1 pr-3 font-medium w-1/3">Campo</th>
                    <th className="py-1 font-medium">Valor removido</th>
                </tr>
            </thead>
            <tbody>
                {keys.map((key) => (
                    <tr key={key} className="border-b border-border/50 last:border-0">
                        <td className="py-1 pr-3 font-medium text-foreground/70">{fieldLabel(key)}</td>
                        <td className="py-1 text-red-500 dark:text-red-400">{formatValue(key, value[key], resolvers)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Selects the right diff presentation based on what data is available */
function AuditDiffSection({ log, resolvers }: { log: AuditLog; resolvers?: Resolvers }) {
    const hasOld = log.old_value !== null;
    const hasNew = log.new_value !== null;

    if (hasOld && hasNew) {
        return (
            <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Alterações</p>
                <DiffTable oldValue={log.old_value!} newValue={log.new_value!} resolvers={resolvers} />
            </div>
        );
    }

    if (hasNew) {
        return (
            <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Dados criados</p>
                <CreateTable value={log.new_value!} resolvers={resolvers} />
            </div>
        );
    }

    if (hasOld) {
        return (
            <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Dados removidos</p>
                <DeleteTable value={log.old_value!} resolvers={resolvers} />
            </div>
        );
    }

    return null;
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function AuditRow({ log, resolvers }: { log: AuditLog; resolvers?: Resolvers }) {
    const [expanded, setExpanded] = useState(false);
    const hasDiff = log.old_value !== null || log.new_value !== null;

    return (
        <>
            <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setExpanded((p) => !p)}
            >
                {/* Data/Hora */}
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDate(log.created_at)}
                </TableCell>

                {/* Ação */}
                <TableCell>
                    <AuditActionBadge action={log.action} />
                </TableCell>

                {/* Entidade */}
                <TableCell>
                    <span className="font-medium text-sm">
                        {RESOURCE_LABELS[log.resource_type] ?? log.resource_type.replace(/_/g, ' ')}
                    </span>
                    {log.resource_id !== null && (
                        <span className="ml-1 text-xs text-muted-foreground">#{log.resource_id}</span>
                    )}
                </TableCell>

                {/* Usuário */}
                <TableCell className="text-sm">
                    {log.user_name ? (
                        <span>{log.user_name}</span>
                    ) : (
                        <span className="text-muted-foreground text-xs">sistema</span>
                    )}
                </TableCell>

                {/* Origem */}
                <TableCell className="text-sm text-muted-foreground">
                    {log.ip_address ?? '—'}
                </TableCell>

                {/* Expand toggle */}
                <TableCell className="w-8">
                    {hasDiff ? (
                        expanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )
                    ) : null}
                </TableCell>
            </TableRow>

            {expanded && (
                <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30 py-3 px-6">
                        <AuditDiffSection log={log} resolvers={resolvers} />
                        {log.user_agent && (
                            <p className="mt-3 text-xs text-muted-foreground truncate">
                                <span className="font-medium">Navegador:</span> {log.user_agent}
                            </p>
                        )}
                    </TableCell>
                </TableRow>
            )}
        </>
    );
}

// ─── Table ────────────────────────────────────────────────────────────────────

interface AuditTableProps {
    data: AuditLog[];
    loading: boolean;
    storeMap?: Record<number, string>;
    filmTypeMap?: Record<number, string>;
}

export function AuditTable({ data, loading, storeMap, filmTypeMap }: AuditTableProps) {
    const resolvers: Resolvers = { storeMap, filmTypeMap };
    return (
        <div className="rounded-lg border bg-card">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-44">Data/Hora</TableHead>
                        <TableHead className="w-40">Ação</TableHead>
                        <TableHead>Entidade</TableHead>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead className="w-8" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                            <TableRow key={i}>
                                {Array.from({ length: 6 }).map((__, j) => (
                                    <TableCell key={j}>
                                        <Skeleton className="h-4 w-full" />
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : data.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="py-16 text-center">
                                <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                                <p className="text-sm text-muted-foreground">Nenhum evento encontrado</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Ajuste os filtros ou aguarde a geração de novos eventos.
                                </p>
                            </TableCell>
                        </TableRow>
                    ) : (
                        data.map((log) => <AuditRow key={log.id} log={log} resolvers={resolvers} />)
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
