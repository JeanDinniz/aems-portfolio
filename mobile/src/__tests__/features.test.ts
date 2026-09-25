import {
    DASHBOARD_ENABLED,
    CONFERENCE_ENABLED,
    ADMIN_CADASTROS_ENABLED,
} from '@/constants/features';

// jest.mock é hoisted pelo babel-jest para antes dos imports, então o mock de
// expo-constants já está ativo quando `@/constants/features` avalia as flags.
jest.mock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: { extra: { featureDashboard: 'true' } } },
}));

describe('feature flags (default OFF)', () => {
    it('liga quando a env é exatamente "true"', () => {
        expect(DASHBOARD_ENABLED).toBe(true);
    });

    it('fica desligada quando ausente', () => {
        expect(CONFERENCE_ENABLED).toBe(false);
        expect(ADMIN_CADASTROS_ENABLED).toBe(false);
    });
});
