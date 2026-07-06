import type { Department, ServiceOrderStatus } from '@/types/service-order.types';

export const DEPARTMENTS: { value: Department; label: string }[] = [
    { value: 'film',          label: 'Película' },
    { value: 'security_film', label: 'Película de Segurança' },
    { value: 'ppf',      label: 'PPF' },
    { value: 'vn',       label: 'VN (Veículos Novos)' },
    { value: 'vd',       label: 'Venda Direta' },
    { value: 'vu',       label: 'VU (Veículos Usados)' },
    { value: 'bodywork', label: 'Funilaria' },
    { value: 'workshop', label: 'Oficina' },
];

export const DEPARTMENTS_MAP: Record<Department, string> = {
    film:          'Película',
    security_film: 'Película de Segurança',
    ppf:      'PPF',
    vn:       'VN',
    vd:       'Venda Direta',
    vu:       'VU',
    bodywork: 'Funilaria',
    workshop: 'Oficina',
};

export const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
    waiting:    'Aguardando',
    doing:      'Fazendo',
    ready:      'Pronto',
    cancelled:  'Cancelada',
    wrong:      'Lançado Errado',
    duplicate:  'Duplicado',
};
