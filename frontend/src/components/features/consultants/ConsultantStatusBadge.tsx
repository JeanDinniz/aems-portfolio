interface ConsultantStatusBadgeProps {
    isActive: boolean;
}

export function ConsultantStatusBadge({ isActive }: ConsultantStatusBadgeProps) {
    if (isActive) {
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700/50">
                Ativo
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-200 dark:bg-zinc-800 text-[#444444] dark:text-zinc-400 border border-[#BDBDBD] dark:border-zinc-700">
            Inativo
        </span>
    );
}
