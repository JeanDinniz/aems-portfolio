/**
 * Feature flags de build (Vite).
 *
 * Ponto eletrônico: em produção o build passa VITE_TIME_CLOCK_ENABLED='false'
 * (deploy.yml) enquanto o módulo está em teste no HML — some o menu, as rotas
 * e o redirect do perfil só-ponto. Backend espelha via TIME_CLOCK_ENABLED.
 */
export const TIME_CLOCK_ENABLED = import.meta.env.VITE_TIME_CLOCK_ENABLED !== 'false';

/**
 * E-book: em produção o build passa VITE_EBOOK_ENABLED='false' (deploy.yml)
 * enquanto o módulo está em teste no HML — some o menu e as rotas. Backend
 * espelha via EBOOK_ENABLED (API responde 404).
 */
export const EBOOK_ENABLED = import.meta.env.VITE_EBOOK_ENABLED !== 'false';

/**
 * Controle de EPIs: em produção o build passa VITE_EPI_ENABLED='false'
 * (deploy.yml) enquanto o módulo está em teste no HML — some o menu e a rota.
 * Backend espelha via EPI_ENABLED (API responde 404).
 */
export const EPI_ENABLED = import.meta.env.VITE_EPI_ENABLED !== 'false';
