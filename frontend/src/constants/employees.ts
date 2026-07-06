export const EMPLOYEE_POSITIONS = [
    { value: 'Lavador a Seco',              label: 'Lavador a Seco' },
    { value: 'Higienizador',                label: 'Higienizador' },
    { value: 'Lavador com Agua',            label: 'Lavador com Agua' },
    { value: 'Polidor',                     label: 'Polidor' },
    { value: 'Martelinho de Ouro',          label: 'Martelinho de Ouro' },
    { value: 'Instalador de Película',      label: 'Instalador de Película' },
    { value: 'Manobrista',                  label: 'Manobrista' },
    { value: 'Encarregado',                 label: 'Encarregado' },
    { value: 'Sub-gerente',                 label: 'Sub-gerente' },
    { value: 'Supervisor Estetica',         label: 'Supervisor Estetica' },
    { value: 'Assistente Administrativo',   label: 'Assistente Administrativo' },
    { value: 'Auxiliar Administrativo',     label: 'Auxiliar Administrativo' },
    { value: 'Supervisor Pelicula',         label: 'Supervisor Pelicula' },
    { value: 'Polidor Funilaria',           label: 'Polidor Funilaria' },
    { value: 'Promotor Vendas',             label: 'Promotor Vendas' },
    { value: 'Jovem Aprendiz',              label: 'Jovem Aprendiz' },
] as const;

/** Instalador de Película é o único cargo vinculado ao departamento film */
export const FILM_INSTALLER_POSITION = 'Instalador de Película';

/** Deriva o department (para filtro backend) a partir do cargo */
export function positionToDepartment(position?: string | null): string | undefined {
    return position === FILM_INSTALLER_POSITION ? 'film' : undefined;
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
    transfer: 'Transferência',
    vacation: 'Férias',
    absence: 'Afastamento',
    fault: 'Falta',
    promotion: 'Promoção',
    dismissal: 'Demissão',
};

export const ABSENCE_TYPES = [
    { value: 'atestado', label: 'Atestado' },
    { value: 'inss', label: 'INSS' },
    { value: 'licenca_maternidade', label: 'Licença Maternidade' },
    { value: 'outro', label: 'Outro' },
];

export const FAULT_TYPES = [
    { value: 'injustificada', label: 'Injustificada' },
    { value: 'atestado', label: 'Atestado' },
    { value: 'folga', label: 'Folga' },
];

export const DISMISSAL_TYPES = [
    { value: 'sem_justa_causa', label: 'Sem Justa Causa' },
    { value: 'justa_causa', label: 'Justa Causa' },
    { value: 'pedido_demissao', label: 'Pedido de Demissão' },
    { value: 'acordo', label: 'Acordo' },
];

export const HR_STATUS_LABELS: Record<string, string> = {
    active: 'Ativo',
    away: 'Afastado',
    dismissed: 'Demitido',
};

export const HR_STATUS_OPTIONS = [
    { value: 'active', label: 'Ativo' },
    { value: 'away', label: 'Afastado' },
    { value: 'dismissed', label: 'Demitido' },
];
