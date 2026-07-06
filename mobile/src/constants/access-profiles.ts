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
];
