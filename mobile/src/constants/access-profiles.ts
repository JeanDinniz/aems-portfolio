import type { SubModule } from '@/types/accessProfile.types';

/** Rótulos legíveis por submódulo (paridade com o web AccessProfileDialog). */
export const SUB_MODULE_LABELS: Record<SubModule, string> = {
    users: 'Usuários',
    stores: 'Lojas',
    consultants: 'Consultores',
    employees: 'Funcionários',
    brands: 'Marcas',
    models: 'Modelos',
    services: 'Serviços',
    profiles: 'Perfis de Acesso',
    service_orders: 'Ordens de Serviço',
    conference: 'Conferência',
    fechamento: 'Fechamento',
    scheduling: 'Agendamentos',
    scheduling_os: 'Gerar O.S. (Agendamento)',
    inventory: 'Estoque',
    time_clock: 'Ponto Eletrônico',
    time_clock_mirror: 'Espelho de Ponto',
    installer_performance: 'Desempenho de Instaladores',
    ebook: 'E-book',
    epi: 'Controle de EPIs',
    material_requests: 'Pedidos de Material',
};

/** Ordem de exibição dos submódulos na matriz (ADM primeiro, depois OPERACIONAL). */
export const SUB_MODULE_ORDER: SubModule[] = [
    'users',
    'stores',
    'consultants',
    'employees',
    'brands',
    'models',
    'services',
    'profiles',
    'service_orders',
    'conference',
    'fechamento',
    'scheduling',
    'scheduling_os',
    'inventory',
    'time_clock',
    'time_clock_mirror',
    'installer_performance',
    'ebook',
    'epi',
    'material_requests',
];
