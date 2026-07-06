import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    ClipboardList, Settings, X,
    UserCog, Users,
    ClipboardCheck, FileSpreadsheet, ShieldCheck,
    Package, LayoutDashboard,
    PanelLeftClose, PanelLeftOpen, Calendar,
    BarChart2, ChevronDown, ChevronRight, ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useMyPermissions } from '@/hooks/useMyPermissions';
import { useAuthStore } from '@/stores/auth.store';
import { WashCenterLogo } from '@/components/brand/WashCenterLogo';
import type { SubModule } from '@/types/accessProfile.types';

type AllowedRole = 'owner' | 'user';

interface SidebarSubItem {
    label: string;
    href: string;
    roles?: AllowedRole[];
    subModule?: SubModule;
}

interface SidebarItem {
    icon: typeof ClipboardList;
    label: string;
    href: string;
    /** If set, only these roles see the item (before permission check). */
    roles?: AllowedRole[];
    /** Se true, o item também é visível para usuários com perfil galpão. */
    allowGalpon?: boolean;
    /** Sub-module key from the new permissions system. If defined, filters by can_view for non-owners. */
    subModule?: SubModule;
    /** If set, renders as an accordion with nested sub-items instead of a direct link. */
    subItems?: SidebarSubItem[];
}

interface SidebarGroup {
    label: string;
    /** If set, only these roles see the entire group. */
    roles?: AllowedRole[];
    /** Se true, o grupo também é visível para usuários com perfil galpão. */
    allowGalpon?: boolean;
    items: SidebarItem[];
}

const sidebarGroups: SidebarGroup[] = [
    {
        label: 'Executivo',
        roles: ['owner'] as AllowedRole[],
        items: [
            { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard', roles: ['owner'] as AllowedRole[] },
        ],
    },
    {
        label: 'Operacional',
        items: [
            { icon: ClipboardList,    label: 'Ordens de Serviço', href: '/service-orders', subModule: 'service_orders' },
            { icon: Calendar,         label: 'Agendamentos',      href: '/scheduling',     subModule: 'scheduling' },
            { icon: ClipboardCheck,   label: 'Conferencia',       href: '/conference',     subModule: 'conference' },
            { icon: FileSpreadsheet,  label: 'Fechamento',        href: '/fechamento',     subModule: 'fechamento' },
            { icon: Package,          label: 'Estoque',           href: '/estoque',        subModule: 'inventory' },
        ],
    },
    {
        label: 'Administracao',
        items: [
            { icon: UserCog,     label: 'Usuarios',         href: '/admin/users',    subModule: 'users' },
            { icon: ShieldCheck, label: 'Perfis de Acesso', href: '/admin/profiles', subModule: 'profiles' },
            { icon: ScrollText,  label: 'Auditoria',        href: '/admin/auditoria', roles: ['owner'] as AllowedRole[] },
            {
                icon: Users,
                label: 'Gestão de Pessoal',
                href: '#',
                subItems: [
                    { label: 'Funcionários',    href: '/admin/employees', subModule: 'employees' },
                    { label: 'Prog. de Férias', href: '/admin/ferias',    subModule: 'employees' },
                ],
            },
            {
                icon: BarChart2,
                label: 'Cadastros',
                href: '#',
                subItems: [
                    { label: 'Consultores',    href: '/admin/consultants',    subModule: 'consultants' },
                    { label: 'Lojas',          href: '/admin/stores',         subModule: 'stores' },
                    { label: 'Serviços',       href: '/servicos',             subModule: 'services' },
                    { label: 'Tipos Pelicula', href: '/admin/tipos-pelicula', roles: ['owner'] as AllowedRole[] },
                    { label: 'Marcas',         href: '/admin/marcas',         subModule: 'brands' },
                    { label: 'Modelos',        href: '/admin/modelos',        subModule: 'models' },
                    { label: 'Fornecedores',   href: '/admin/fornecedores',   roles: ['owner'] as AllowedRole[] },
                ],
            },
        ],
    },
    {
        label: 'Sistema',
        items: [
            { icon: Settings, label: 'Configuracoes', href: '/settings' },
        ],
    },
];

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const location = useLocation();
    const { user } = useAuth();
    const hasPermissionFn = useAuthStore((s) => s.hasPermission);
    const isOwnerFn = useAuthStore((s) => s.isOwner);
    const effectivePermissions = useAuthStore((s) => s.effectivePermissions);
    const isGalponProfile = effectivePermissions?.is_galpon_profile === true;
    const [isCollapsed, setIsCollapsed] = useState(
        () => localStorage.getItem('sidebar-collapsed') === 'true'
    );
    const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
    useMyPermissions();

    const isActive = (href: string) =>
        location.pathname.startsWith(href);

    const canViewItem = (item: SidebarItem | SidebarSubItem): boolean => {
        if (!item.subModule || isOwnerFn()) return true;
        return hasPermissionFn(item.subModule, 'view');
    };

    const canViewSubItem = (sub: SidebarSubItem): boolean => {
        const roleOk = !sub.roles || !!(user?.role && sub.roles.includes(user.role as AllowedRole));
        const permOk = !sub.subModule || isOwnerFn() || hasPermissionFn(sub.subModule, 'view');
        return roleOk && permOk;
    };

    // Auto-expand accordion if any sub-item is active
    useEffect(() => {
        for (const group of sidebarGroups) {
            for (const item of group.items) {
                if (item.subItems) {
                    const hasActive = item.subItems.some((sub) => isActive(sub.href));
                    if (hasActive) {
                        setExpandedItems((prev) => new Set(prev).add(item.label));
                    }
                }
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    const toggleAccordion = (label: string) => {
        setExpandedItems((prev) => {
            const next = new Set(prev);
            if (next.has(label)) {
                next.delete(label);
            } else {
                next.add(label);
            }
            return next;
        });
    };

    const visibleGroups = sidebarGroups.filter(
        (g) => !g.roles
            || (user?.role && g.roles.includes(user.role as AllowedRole))
            || (isGalponProfile && g.allowGalpon)
    );

    const userInitials =
        user?.full_name?.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() ?? 'U';

    const expanded = !isCollapsed;

    const toggleCollapsed = () => {
        const next = !isCollapsed;
        setIsCollapsed(next);
        localStorage.setItem('sidebar-collapsed', String(next));
    };

    return (
        <>
            {/* Mobile Overlay */}
            <div
                className={cn(
                    'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity duration-200',
                    isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
                onClick={onClose}
                onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
                role="button"
                tabIndex={isOpen ? 0 : -1}
                aria-label="Fechar menu"
            />

            {/* Sidebar */}
            <aside
                className={cn(
                    'flex flex-col flex-shrink-0',
                    'border-r border-[#1E1E1E]',
                    'transition-all duration-200 ease-in-out',
                    'fixed inset-y-0 left-0 z-50',
                    'md:relative md:inset-auto md:z-auto',
                    'w-[220px]',
                    isCollapsed ? 'md:w-[56px]' : 'md:w-[220px]',
                )}
                style={{ backgroundColor: '#111111' }}
                aria-label="Navegacao principal"
            >
                {/* Logo / Header */}
                <div
                    className="flex h-[60px] items-center justify-between px-3 flex-shrink-0 border-b border-[#1E1E1E] overflow-hidden"
                    style={{ backgroundColor: '#111111' }}
                >
                    <div className={cn(
                        'items-center transition-all duration-200',
                        'hidden md:hidden',
                        expanded && 'md:flex',
                        'max-md:flex'
                    )}>
                        <WashCenterLogo size={28} />
                    </div>

                    {/* Desktop: collapse toggle button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            'hidden md:flex text-[#555] hover:text-white hover:bg-[#1E1E1E] h-8 w-8 flex-shrink-0',
                            isCollapsed && 'mx-auto'
                        )}
                        onClick={toggleCollapsed}
                        aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'}
                    >
                        {isCollapsed
                            ? <PanelLeftOpen className="h-4 w-4" />
                            : <PanelLeftClose className="h-4 w-4" />
                        }
                    </Button>

                    {/* Mobile: close button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="md:hidden text-[#555] hover:text-white hover:bg-[#1E1E1E] h-8 w-8 flex-shrink-0"
                        onClick={onClose}
                        aria-label="Fechar menu"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Nav */}
                <nav
                    className="flex-1 overflow-y-auto overflow-x-hidden py-2 aems-scroll"
                    style={{ backgroundColor: '#111111' }}
                >
                    {visibleGroups.map((group) => {
                        const visibleItems = group.items.filter((item) => {
                            const roleOk = !item.roles
                                || (user?.role && item.roles.includes(user.role as AllowedRole))
                                || (isGalponProfile && item.allowGalpon);
                            if (!roleOk) return false;
                            if (item.subItems) {
                                // Show accordion only if at least one sub-item is visible
                                return item.subItems.some(canViewSubItem);
                            }
                            return canViewItem(item);
                        });
                        if (!visibleItems.length) return null;

                        return (
                            <div key={group.label} className="mt-6 first:mt-2">
                                {/* Group label */}
                                <div className={cn(
                                    'transition-all duration-200 overflow-hidden',
                                    'md:h-0 md:opacity-0',
                                    expanded && 'md:h-auto md:opacity-100',
                                    'max-md:h-auto max-md:opacity-100'
                                )}>
                                    <p
                                        className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] select-none whitespace-nowrap"
                                        style={{ color: '#6B7280' }}
                                    >
                                        {group.label}
                                    </p>
                                </div>

                                <div className="space-y-0.5 px-2">
                                    {visibleItems.map((item) => {
                                        const Icon = item.icon;

                                        // Accordion item
                                        if (item.subItems) {
                                            const visibleSubs = item.subItems.filter(canViewSubItem);
                                            const hasActiveSub = visibleSubs.some((sub) => isActive(sub.href));
                                            const isExpanded = expandedItems.has(item.label) || hasActiveSub;

                                            return (
                                                <div key={item.label}>
                                                    {/* Accordion header */}
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleAccordion(item.label)}
                                                        className={cn(
                                                            'flex items-center gap-2.5 py-2 rounded-lg text-sm transition-colors',
                                                            'px-3 md:justify-center hover:bg-[#1E1E1E]',
                                                            // Expanded: full width so chevron stays on the right
                                                            expanded && 'md:justify-start md:w-full',
                                                            // Mobile always full width
                                                            'max-md:w-full',
                                                        )}
                                                        style={hasActiveSub
                                                            ? { color: '#F2F2F2', backgroundColor: 'rgba(245,168,0,0.15)' }
                                                            : { color: '#F2F2F2' }
                                                        }
                                                        onMouseEnter={(e) => {
                                                            if (!hasActiveSub) {
                                                                (e.currentTarget as HTMLButtonElement).style.color = '#FFFFFF';
                                                            }
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            if (!hasActiveSub) {
                                                                (e.currentTarget as HTMLButtonElement).style.color = '#F2F2F2';
                                                            }
                                                        }}
                                                    >
                                                        <Icon className="h-4 w-4 flex-shrink-0" />
                                                        {/* Label + chevron — hidden when collapsed */}
                                                        <span className={cn(
                                                            'flex-1 flex items-center justify-between truncate leading-none transition-all duration-200 whitespace-nowrap',
                                                            'md:opacity-0 md:w-0 md:overflow-hidden',
                                                            expanded && 'md:opacity-100 md:w-auto md:overflow-visible',
                                                            'max-md:opacity-100 max-md:w-auto'
                                                        )}>
                                                            {item.label}
                                                            {isExpanded
                                                                ? <ChevronDown className="h-3 w-3 flex-shrink-0" />
                                                                : <ChevronRight className="h-3 w-3 flex-shrink-0" />
                                                            }
                                                        </span>
                                                    </button>

                                                    {/* Sub-items — visible when expanded and sidebar not collapsed */}
                                                    {isExpanded && (
                                                        <div className={cn(
                                                            'mt-0.5 space-y-0.5',
                                                            // Hide sub-items when desktop-collapsed
                                                            'md:hidden',
                                                            expanded && 'md:block',
                                                            'max-md:block'
                                                        )}>
                                                            {visibleSubs.map((sub) => {
                                                                const subActive = isActive(sub.href);
                                                                return (
                                                                    <Link
                                                                        key={sub.href}
                                                                        to={sub.href}
                                                                        onClick={onClose}
                                                                        className="flex items-center py-1.5 pl-9 pr-3 rounded-lg text-sm transition-colors"
                                                                        style={subActive
                                                                            ? { color: '#111111', backgroundColor: '#F5A800' }
                                                                            : { color: '#F2F2F2' }
                                                                        }
                                                                        onMouseEnter={(e) => {
                                                                            if (!subActive) {
                                                                                (e.currentTarget as HTMLAnchorElement).style.color = '#FFFFFF';
                                                                                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#1E1E1E';
                                                                            }
                                                                        }}
                                                                        onMouseLeave={(e) => {
                                                                            if (!subActive) {
                                                                                (e.currentTarget as HTMLAnchorElement).style.color = '#F2F2F2';
                                                                                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent';
                                                                            }
                                                                        }}
                                                                        aria-current={subActive ? 'page' : undefined}
                                                                    >
                                                                        {sub.label}
                                                                    </Link>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }

                                        // Regular item
                                        const active = isActive(item.href);
                                        return (
                                            <Link
                                                key={item.href}
                                                to={item.href}
                                                onClick={onClose}
                                                className={cn(
                                                    'flex items-center gap-2.5 py-2 rounded-lg text-sm transition-colors',
                                                    'md:justify-center',
                                                    expanded && 'md:justify-start',
                                                    active
                                                        ? 'border-l-2 border-[#F5A800] -ml-px pl-[11px] pr-3'
                                                        : 'px-3 hover:bg-[#1E1E1E]'
                                                )}
                                                style={active
                                                    ? { color: '#F5A800', backgroundColor: 'rgba(245,168,0,0.10)' }
                                                    : { color: '#F2F2F2' }
                                                }
                                                onMouseEnter={(e) => {
                                                    if (!active) {
                                                        (e.currentTarget as HTMLAnchorElement).style.color = '#FFFFFF';
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (!active) {
                                                        (e.currentTarget as HTMLAnchorElement).style.color = '#F2F2F2';
                                                    }
                                                }}
                                                aria-current={active ? 'page' : undefined}
                                            >
                                                <Icon
                                                    className="h-4 w-4 flex-shrink-0"
                                                    style={active ? { color: '#F5A800' } : undefined}
                                                />
                                                <span className={cn(
                                                    'truncate leading-none transition-all duration-200 whitespace-nowrap',
                                                    'md:opacity-0 md:w-0 md:overflow-hidden',
                                                    expanded && 'md:opacity-100 md:w-auto md:overflow-visible',
                                                    'max-md:opacity-100 max-md:w-auto'
                                                )}>
                                                    {item.label}
                                                </span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div
                    className="flex-shrink-0 px-2 py-3 border-t border-[#1E1E1E] overflow-hidden"
                    style={{ backgroundColor: '#111111' }}
                >
                    <div className={cn(
                        'flex items-center py-2 rounded-lg transition-colors cursor-default hover:bg-[#1A1A1A]',
                        'md:justify-center md:px-0',
                        expanded && 'md:justify-start md:px-2 md:gap-2.5',
                        'max-md:gap-2.5 max-md:px-2'
                    )}>
                        <div
                            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'rgba(245,168,0,0.20)' }}
                        >
                            <span className="text-[10px] font-bold" style={{ color: '#F5A800' }}>
                                {userInitials}
                            </span>
                        </div>
                        <div className={cn(
                            'min-w-0 transition-all duration-200',
                            'md:opacity-0 md:w-0 md:overflow-hidden',
                            expanded && 'md:opacity-100 md:w-auto md:overflow-visible',
                            'max-md:opacity-100 max-md:w-auto'
                        )}>
                            <p className="text-xs font-medium text-white truncate leading-tight whitespace-nowrap">
                                {user?.full_name ?? 'Usuario'}
                            </p>
                            <p className="text-[10px] truncate leading-none whitespace-nowrap" style={{ color: '#555' }}>
                                {user?.email ?? ''}
                            </p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Mobile: slide in */}
            <style>{`
                @media (max-width: 767px) {
                    aside[aria-label="Navegacao principal"] {
                        transform: ${isOpen ? 'translateX(0)' : 'translateX(-100%)'};
                    }
                }
            `}</style>
        </>
    );
}
