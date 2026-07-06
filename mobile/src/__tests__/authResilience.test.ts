/**
 * QA-06 — Resiliência de sessão (anti-bug-PWA).
 *
 * O app nasceu para NÃO deslogar como o PWA fazia no iOS ao abrir a câmera. O
 * coração dessa garantia é: tokens vivem SÓ no SecureStore (Keychain/Keystore) e
 * sobrevivem a background/foreground e a fechar/reabrir o app; o estado persistido
 * em AsyncStorage NUNCA contém tokens. No boot, `bootstrapAuth()` restaura a sessão
 * a partir do SecureStore se os tokens ainda forem válidos.
 *
 * Estes testes COMPLEMENTAM `auth.store.test.ts` (que já cobre bootstrap com token
 * válido / ausente / refresh expirado):
 *   - partialize NÃO expõe tokens (garantia central "tokens só no SecureStore");
 *   - a sessão sobrevive a um ciclo background→foreground (tokens permanecem);
 *   - refresh no limite dos 7 dias ainda restaura (fronteira do TTL);
 *   - falha do SecureStore no boot não trava o app (isLoading vira false).
 */
import { useAuthStore } from '@/stores/auth.store';
import { secureStorage, appStorage, TOKEN_META_KEY } from '@/lib/storage';
import type { User, AuthTokens } from '@/types/auth.types';

const user: User = {
    id: 7,
    full_name: 'Instalador Loja',
    email: 'inst@aems.com',
    role: 'user',
    store_id: 3,
    is_active: true,
    must_change_password: false,
    created_at: '2024-01-01',
    updated_at: null,
};

const tokens: AuthTokens = { accessToken: 'access-xyz', refreshToken: 'refresh-xyz', expiresIn: 1800 };

beforeEach(async () => {
    jest.clearAllMocks();
    await secureStorage.clearTokens();
    await appStorage.remove(TOKEN_META_KEY);
    useAuthStore.setState({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isLoading: true,
        effectivePermissions: null,
    });
});

describe('Tokens só no SecureStore', () => {
    it('setAuth persiste tokens no SecureStore, não em AsyncStorage', async () => {
        const secureSpy = jest.spyOn(secureStorage, 'setTokens');
        const appSpy = jest.spyOn(appStorage, 'set');

        useAuthStore.getState().setAuth(user, tokens);
        // Aguarda o fire-and-forget de persistTokens.
        await Promise.resolve();
        await Promise.resolve();

        expect(secureSpy).toHaveBeenCalledWith('access-xyz', 'refresh-xyz');
        // O ÚNICO write em AsyncStorage é o metadado de validade (sem o token em si).
        const appWriteKeys = appSpy.mock.calls.map((c) => c[0]);
        expect(appWriteKeys).toContain(TOKEN_META_KEY);
        const metaWrite = appSpy.mock.calls.find((c) => c[0] === TOKEN_META_KEY)?.[1];
        expect(JSON.stringify(metaWrite)).not.toContain('access-xyz');
        expect(JSON.stringify(metaWrite)).not.toContain('refresh-xyz');
    });

    it('o estado persistido (partialize) contém apenas user + isAuthenticated, nunca tokens', () => {
        // Acessa a config do persist middleware para inspecionar o partialize real.
        // zustand/persist expõe `persist` no store; `getOptions().partialize`.
        const persistApi = (useAuthStore as unknown as {
            persist: { getOptions: () => { partialize?: (s: unknown) => Record<string, unknown> } };
        }).persist;
        const partialize = persistApi.getOptions().partialize!;

        const full = {
            user,
            tokens, // presente no estado em memória…
            isAuthenticated: true,
            isLoading: false,
            effectivePermissions: { permissions: [], store_ids: [], is_galpon_profile: false, hide_galpon_option: false },
        };
        const persisted = partialize(full);

        expect(persisted).toEqual({ user, isAuthenticated: true });
        // …mas JAMAIS gravado no AsyncStorage.
        expect(persisted).not.toHaveProperty('tokens');
        expect(persisted).not.toHaveProperty('effectivePermissions');
        expect(JSON.stringify(persisted)).not.toContain('access-xyz');
        expect(JSON.stringify(persisted)).not.toContain('refresh-xyz');
    });
});

describe('Sessão sobrevive ao ciclo de vida (background → foreground / câmera)', () => {
    it('após restaurar do SecureStore, permanece autenticado', async () => {
        // Simula um app reaberto: tokens válidos no SecureStore + user reidratado
        // pelo persist. bootstrapAuth deve manter a sessão (o que o PWA quebrava).
        await secureStorage.setTokens('acc-restore', 'ref-restore');
        await appStorage.set(TOKEN_META_KEY, { expiresIn: 1800, persistedAt: Date.now() });
        useAuthStore.setState({ user, isAuthenticated: false, isLoading: true });

        await useAuthStore.getState().bootstrapAuth();

        const s = useAuthStore.getState();
        expect(s.isAuthenticated).toBe(true);
        expect(s.tokens?.accessToken).toBe('acc-restore');
        expect(s.tokens?.refreshToken).toBe('ref-restore');
        expect(s.user?.id).toBe(7);
    });

    it('reidratação com usuário ausente cai deslogado (não há sessão a restaurar)', async () => {
        // Tokens no SecureStore mas SEM user reidratado → não restaura (limpa).
        await secureStorage.setTokens('acc', 'ref');
        await appStorage.set(TOKEN_META_KEY, { expiresIn: 1800, persistedAt: Date.now() });
        useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true });

        await useAuthStore.getState().bootstrapAuth();

        expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('refresh a poucos segundos do limite de 7 dias ainda restaura a sessão', async () => {
        await secureStorage.setTokens('acc-edge', 'ref-edge');
        // 7 dias - 1 minuto: ainda válido (o corte é >= 7 dias).
        const almost7d = Date.now() - (7 * 24 * 60 * 60 * 1000 - 60_000);
        await appStorage.set(TOKEN_META_KEY, { expiresIn: 1800, persistedAt: almost7d });
        useAuthStore.setState({ user, isAuthenticated: false, isLoading: true });

        await useAuthStore.getState().bootstrapAuth();

        expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
});

describe('Robustez do boot', () => {
    it('erro ao ler o SecureStore não trava o app (isLoading = false)', async () => {
        jest.spyOn(secureStorage, 'getToken').mockRejectedValueOnce(new Error('keychain indisponível'));
        useAuthStore.setState({ user, isAuthenticated: true, isLoading: true });

        await useAuthStore.getState().bootstrapAuth();

        expect(useAuthStore.getState().isLoading).toBe(false);
    });
});
