import Constants from 'expo-constants';

/**
 * Feature flags de build do mobile — mesma fonte de env.ts (Constants.expoConfig.extra),
 * injetadas por app.config.ts a partir de process.env. Semântica **default OFF**:
 * a flag só liga quando a env é exatamente 'true'. Assim o app nasce enxuto e os
 * módulos secundários ficam ocultos até serem explicitamente habilitados no perfil
 * do eas.json (ou no `npx expo start` em dev). As telas seguem no stack — reativar
 * é só ligar a flag, sem refatorar.
 */
type FeatureExtra = {
    featureConference?: string;
    featureFechamento?: string;
    featureDashboard?: string;
    featureInstallerPerformance?: string;
    featureEbook?: string;
    featureAdminCadastros?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as FeatureExtra;

const on = (v: string | undefined): boolean => v === 'true';

export const CONFERENCE_ENABLED = on(extra.featureConference);
export const FECHAMENTO_ENABLED = on(extra.featureFechamento);
export const DASHBOARD_ENABLED = on(extra.featureDashboard);
export const INSTALLER_PERFORMANCE_ENABLED = on(extra.featureInstallerPerformance);
export const EBOOK_ENABLED = on(extra.featureEbook);
export const ADMIN_CADASTROS_ENABLED = on(extra.featureAdminCadastros);
