import { type LucideIcon, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
    icon?: LucideIcon;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
}

export function EmptyState({
    icon: Icon = Inbox,
    title,
    description,
    actionLabel,
    onAction,
    className,
}: EmptyStateProps) {
    return (
        <div className={cn(
            'flex flex-col items-center justify-center py-16 px-6 text-center',
            className
        )}>
            <div className="w-16 h-16 rounded-2xl bg-aems-neutral-100 flex items-center justify-center mb-4">
                <Icon className="w-8 h-8 text-aems-neutral-300" strokeWidth={1.5} />
            </div>
            <h3 className="text-base font-semibold text-aems-neutral-600 mb-1">{title}</h3>
            {description && (
                <p className="text-sm text-aems-neutral-400 max-w-xs leading-relaxed mb-5">{description}</p>
            )}
            {actionLabel && onAction && (
                <Button
                    onClick={onAction}
                    className="bg-aems-primary-400 hover:bg-aems-primary-500 text-aems-neutral-900 font-semibold"
                >
                    {actionLabel}
                </Button>
            )}
        </div>
    );
}
