/**
 * Labels PT-BR do módulo de Auditoria.
 *
 * Fonte única para a tela de Auditoria (mobile) — os valores crus vêm do backend
 * (app/core/audit.py e services que chamam log_audit). Ação/entidade sem entrada
 * aqui cai no fallback do componente.
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
    // Autenticação
    login: 'Login',
    login_failed: 'Falha de Login',
    logout: 'Logout',
    password_change: 'Troca de Senha',
    password_change_failed: 'Falha na Troca de Senha',
    password_reset: 'Reset de Senha',
    // CRUD genérico
    create: 'Criação',
    update: 'Atualização',
    delete: 'Exclusão',
    activate: 'Ativação',
    deactivate: 'Desativação',
    cancel: 'Cancelamento',
    // Ordem de Serviço
    status_change: 'Mudança de Status',
    verify: 'Verificação',
    unverify: 'Verificação Desfeita',
    // Agendamento
    generate_os: 'O.S. Gerada',
    finalize_os: 'O.S. Finalizada',
    // Estoque (bobinas)
    consume: 'Consumo',
    exhaust: 'Esgotamento',
    release: 'Liberação',
    restore: 'Restauração',
    transfer: 'Transferência',
    // Usuários (ações legadas do módulo users)
    user_created: 'Usuário Criado',
    user_updated: 'Usuário Atualizado',
    user_deleted: 'Usuário Excluído',
    user_activated: 'Usuário Ativado',
    user_deactivated: 'Usuário Desativado',
    role_changed: 'Perfil Alterado',
};

export const AUDIT_RESOURCE_LABELS: Record<string, string> = {
    auth: 'Autenticação',
    user: 'Usuário',
    employee: 'Funcionário',
    consultant: 'Consultor',
    service_order: 'Ordem de Serviço',
    store: 'Loja',
    access_profile: 'Perfil de Acesso',
    film_type: 'Tipo de Película',
    film_roll: 'Bobina',
    appointment: 'Agendamento',
    service: 'Serviço',
    brand: 'Marca',
    vehicle_model: 'Modelo de Veículo',
    supplier: 'Fornecedor',
};
