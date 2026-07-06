import { Crown, ShieldCheck } from 'lucide-react';

type KnownRole = 'owner' | 'user';

interface RoleBadgeProps {
    role: string;
}

const roleConfig: Record<KnownRole, { label: string; icon: typeof Crown; className: string }> = {
    owner: {
        label: 'Proprietario',
        icon: Crown,
        className: 'bg-[#F5A800]/15 text-[#8A6000] dark:text-[#F5A800] border border-[#F5A800]/40',
    },
    user: {
        label: 'Usuario',
        icon: ShieldCheck,
        className: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-700/50',
    },
};

export function RoleBadge({ role }: RoleBadgeProps) {
    const config = roleConfig[role as KnownRole];
    if (!config) return null;
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${config.className}`}>
            <Icon className="h-3 w-3" />
            {config.label}
        </span>
    );
}
