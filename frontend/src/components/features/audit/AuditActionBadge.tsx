import { cn } from '@/lib/utils';

const ACTION_STYLES: Record<string, { label: string; className: string }> = {
    login:            { label: 'Login',              className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
    logout:           { label: 'Logout',             className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
    create:           { label: 'Criação',            className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
    update:           { label: 'Atualização',        className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
    delete:           { label: 'Exclusão',           className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
    cancel:           { label: 'Cancelamento',       className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
    status_change:    { label: 'Mudança de Status',  className: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300' },
    activate:         { label: 'Ativação',           className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300' },
    deactivate:       { label: 'Desativação',        className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300' },
    verify:           { label: 'Verificação',        className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300' },
    password_reset:   { label: 'Reset de Senha',     className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' },
    consume:          { label: 'Consumo',            className: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300' },
    exhaust:          { label: 'Esgotamento',        className: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300' },
    restore:          { label: 'Restauração',        className: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300' },
    generate_os:      { label: 'O.S. Gerada',        className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
    user_created:     { label: 'Usuário Criado',     className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
    user_updated:     { label: 'Usuário Atualizado', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
    user_deleted:     { label: 'Usuário Excluído',   className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
    user_activated:   { label: 'Usuário Ativado',    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300' },
    user_deactivated: { label: 'Usuário Desativado', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300' },
    role_changed:     { label: 'Perfil Alterado',    className: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300' },
};

interface AuditActionBadgeProps {
    action: string;
}

export function AuditActionBadge({ action }: AuditActionBadgeProps) {
    const style = ACTION_STYLES[action] ?? {
        label: action.replace(/_/g, ' '),
        className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    };
    return (
        <span
            className={cn(
                'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold tracking-wide',
                style.className
            )}
        >
            {style.label}
        </span>
    );
}
