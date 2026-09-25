import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Menu, Bell, CheckCheck, LogOut, User, Settings, Wifi, WifiOff, Download } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useWsStatus } from "@/hooks/useWsStatus";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useNotifications, useUnreadNotificationCount, useMarkAllNotificationsRead, useMarkNotificationRead } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

interface HeaderProps {
    onMenuClick: () => void;
}

const roleLabels: Record<string, string> = {
    owner: 'Proprietário',
    user: 'Usuário',
};


function RoleBadge({ role }: { role: string }) {
    if (role === 'owner') {
        return (
            <span
                className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                style={{
                    backgroundColor: 'rgba(245,168,0,0.15)',
                    color: '#F5A800',
                    borderColor: 'rgba(245,168,0,0.30)',
                }}
            >
                {roleLabels[role]}
            </span>
        );
    }
    return (
        <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
            {roleLabels[role] ?? role}
        </span>
    );
}

const wsStatusConfig = {
    connected:    { icon: Wifi,    color: 'text-emerald-500', label: 'Tempo real: conectado' },
    connecting:   { icon: Wifi,    color: 'text-amber-400',   label: 'Tempo real: reconectando...' },
    disconnected: { icon: WifiOff, color: 'text-red-400',     label: 'Tempo real: desconectado' },
} as const;

function WsIndicator({ status }: { status: keyof typeof wsStatusConfig }) {
    const { icon: Icon, color, label } = wsStatusConfig[status];
    return (
        <span
            className={`hidden sm:flex items-center ${color}`}
            title={label}
            aria-label={label}
        >
            <Icon className="h-4 w-4" />
        </span>
    );
}

function formatRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `${minutes}min atrás`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h atrás`;
    return `${Math.floor(hours / 24)}d atrás`;
}

export function Header({ onMenuClick }: HeaderProps) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const wsStatus = useWsStatus();
    const { data: unreadCount = 0 } = useUnreadNotificationCount();
    const { data: notifications = [] } = useNotifications(5);
    const markAllRead = useMarkAllNotificationsRead();
    const markRead = useMarkNotificationRead();
    const { canInstall, install } = useInstallPrompt();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const getInitials = (name: string) =>
        name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();

    const userInitials = user?.full_name ? getInitials(user.full_name) : 'U';

    return (
        <header
            className="app-header sticky top-0 z-30 flex h-[60px] w-full items-center justify-between px-4 md:px-6 bg-header border-b border-header-border"
        >
            {/* Left: hamburger (mobile only) */}
            <div className="flex items-center">
                <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden h-8 w-8 text-[#666666] dark:text-[#666] hover:bg-gray-100 dark:hover:bg-[#222]"
                    onClick={onMenuClick}
                    aria-label="Abrir menu"
                >
                    <Menu className="h-5 w-5" />
                </Button>
            </div>

            {/* Right: role badge + connection + notifications + avatar */}
            <div className="flex items-center gap-2">
                {user?.role && <RoleBadge role={user.role} />}

                {/* WebSocket connection indicator */}
                <WsIndicator status={wsStatus} />

                {/* PWA Install button — aparece apenas quando o browser oferece instalação */}
                {canInstall && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={install}
                        title="Instalar App"
                        className="h-9 w-9 text-[#F5A800] hover:bg-[#F5A800]/10 dark:hover:bg-[#F5A800]/10"
                    >
                        <Download className="h-4 w-4" />
                    </Button>
                )}

                {/* Notifications Bell */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="relative h-9 w-9 text-[#666666] dark:text-[#666] hover:bg-gray-100 dark:hover:bg-[#222]"
                            aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ''}`}
                        >
                            <Bell className="h-5 w-5" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none animate-pulse">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-80 shadow-lg bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#2A2A2A]"
                        align="end"
                    >
                        <DropdownMenuLabel className="flex items-center justify-between py-3">
                            <div className="flex items-center gap-2">
                                <Bell className="h-4 w-4 text-[#666666] dark:text-[#666]" />
                                <span className="font-semibold text-sm text-[#111111] dark:text-white">Notificações</span>
                                {unreadCount > 0 && (
                                    <Badge className="h-5 text-[10px] bg-red-500 text-white border-0 px-1.5">
                                        {unreadCount}
                                    </Badge>
                                )}
                            </div>
                            {unreadCount > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs gap-1 px-2 text-[#F5A800] hover:bg-gray-100 dark:hover:bg-[#222]"
                                    onClick={() => markAllRead.mutate()}
                                    disabled={markAllRead.isPending}
                                >
                                    <CheckCheck className="h-3 w-3" />
                                    Marcar todas
                                </Button>
                            )}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-[#E8E8E8] dark:bg-[#2A2A2A]" />

                        {notifications.length === 0 ? (
                            <div className="py-8 text-center">
                                <Bell className="h-8 w-8 mx-auto mb-2 text-[#BDBDBD] dark:text-[#333]" />
                                <p className="text-sm text-[#999999] dark:text-[#555]">Sem notificações</p>
                            </div>
                        ) : (
                            <div className="max-h-80 overflow-y-auto aems-scroll">
                                {notifications.map((notification) => (
                                    <DropdownMenuItem
                                        key={notification.id}
                                        className={cn(
                                            'flex flex-col items-start gap-1 p-3 cursor-pointer rounded-none border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-0 hover:bg-gray-50 dark:hover:bg-[#222]',
                                            !notification.read && 'bg-[#F5A800]/5'
                                        )}
                                        onClick={() => {
                                            if (!notification.read) markRead.mutate(notification.id);
                                            if (notification.related_url) navigate(notification.related_url);
                                        }}
                                    >
                                        <div className="flex w-full items-start justify-between gap-2">
                                            <span className={cn(
                                                'text-sm leading-tight',
                                                !notification.read
                                                    ? 'font-semibold text-[#111111] dark:text-white'
                                                    : 'text-[#666666] dark:text-white/70'
                                            )}>
                                                {notification.title}
                                            </span>
                                            {!notification.read && (
                                                <span
                                                    className="w-2 h-2 rounded-full shrink-0 mt-1 aems-dot-pulse bg-[#F5A800]"
                                                    aria-hidden="true"
                                                />
                                            )}
                                        </div>
                                        <p className="text-xs line-clamp-2 leading-relaxed text-[#666666] dark:text-[#666]">
                                            {notification.message}
                                        </p>
                                        <span className="text-[10px] text-[#999999] dark:text-[#444]">
                                            {formatRelativeTime(notification.created_at)}
                                        </span>
                                    </DropdownMenuItem>
                                ))}
                            </div>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* Avatar + user menu */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            className="relative h-9 w-9 rounded-full p-0 hover:ring-2 transition-all"
                            style={{ ['--tw-ring-color' as string]: 'rgba(245,168,0,0.30)' }}
                        >
                            <Avatar className="h-9 w-9">
                                <AvatarImage src={undefined} alt={user?.full_name} />
                                <AvatarFallback
                                    className="text-xs font-bold"
                                    style={{ backgroundColor: 'rgba(245,168,0,0.20)', color: '#F5A800' }}
                                >
                                    {userInitials}
                                </AvatarFallback>
                            </Avatar>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-60 shadow-lg bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#2A2A2A]"
                        align="end"
                        forceMount
                    >
                        <DropdownMenuLabel className="font-normal p-3">
                            <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                    <AvatarFallback
                                        className="text-sm font-bold"
                                        style={{ backgroundColor: 'rgba(245,168,0,0.20)', color: '#F5A800' }}
                                    >
                                        {userInitials}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex flex-col min-w-0">
                                    <p className="text-sm font-semibold text-[#111111] dark:text-white truncate">{user?.full_name}</p>
                                    <p className="text-xs truncate text-[#999999] dark:text-[#555]">{user?.email}</p>
                                    {user?.role && (
                                        <div className="mt-1">
                                            <RoleBadge role={user.role} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-[#E8E8E8] dark:bg-[#2A2A2A]" />
                        <DropdownMenuItem
                            className="gap-2 cursor-pointer text-[#666666] dark:text-[#999] hover:bg-gray-50 dark:hover:bg-[#222]"
                            onClick={() => navigate('/profile')}
                        >
                            <User className="h-4 w-4" />
                            Meu Perfil
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="gap-2 cursor-pointer text-[#666666] dark:text-[#999] hover:bg-gray-50 dark:hover:bg-[#222]"
                            onClick={() => navigate('/settings')}
                        >
                            <Settings className="h-4 w-4" />
                            Configurações
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-[#E8E8E8] dark:bg-[#2A2A2A]" />
                        <DropdownMenuItem
                            className="gap-2 cursor-pointer text-red-400 focus:text-red-400 focus:bg-red-500/10"
                            onClick={handleLogout}
                        >
                            <LogOut className="h-4 w-4" />
                            Sair
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
