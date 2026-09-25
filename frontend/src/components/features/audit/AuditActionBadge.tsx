import { cn } from '@/lib/utils';
import { AUDIT_ACTION_LABELS } from '@/constants/audit';

const NEUTRAL = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';

const ACTION_CLASSES: Record<string, string> = {
    login:                  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    login_failed:           'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    logout:                 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    password_change:        'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    password_change_failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    password_reset:         'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    create:                 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    update:                 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    delete:                 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    cancel:                 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    status_change:          'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
    activate:               'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
    deactivate:             'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    verify:                 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
    unverify:               'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    consume:                'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
    exhaust:                'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
    release:                'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
    restore:                'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
    transfer:               'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
    generate_os:            'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    finalize_os:            'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
    user_created:           'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    user_updated:           'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    user_deleted:           'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    user_activated:         'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300',
    user_deactivated:       'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    role_changed:           'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
};

interface AuditActionBadgeProps {
    action: string;
}

export function AuditActionBadge({ action }: AuditActionBadgeProps) {
    const label = AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
    return (
        <span
            className={cn(
                'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold tracking-wide',
                ACTION_CLASSES[action] ?? NEUTRAL
            )}
        >
            {label}
        </span>
    );
}
