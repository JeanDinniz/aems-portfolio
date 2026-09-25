import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui';
import { authenticate, isAppLockSuppressed } from '@/services/biometrics';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';
import { brand } from '@/theme/tokens';

/**
 * BiometricGate (Sprint 7 — HARD-01).
 *
 * Cobre a árvore autenticada com um overlay de bloqueio quando o usuário ativou
 * o "Desbloqueio por biometria" (settings) E há sessão válida. Regra do doc 02
 * §5: os tokens já vivem no Keychain/Keystore; a biometria só desbloqueia o uso
 * local — não faz novo login.
 *
 * Ciclo de vida:
 * - **Cold start**: se `biometricEnabled && isAuthenticated`, inicia BLOQUEADO.
 * - **Volta do background**: re-bloqueia no próximo `active`, EXCETO quando o
 *   próprio prompt de biometria trouxe o app para background momentaneamente
 *   (`suppressLock`). Também ignoramos re-lock se ficamos em background por menos
 *   de um limiar curto (o prompt nativo do SO some rápido) — dupla proteção
 *   contra falso re-lock.
 * - Não desmonta a navegação: apenas sobrepõe um overlay absoluto (preserva o
 *   estado das telas por baixo).
 *
 * Fallback de senha: além do fallback de PIN/senha do próprio prompt do SO, há um
 * botão "Entrar com senha" que faz logout → o RootNavigator cai no LoginScreen.
 */

// Se o app ficou em background por menos que isto, não re-bloqueia. Cobre o
// vaivém momentâneo do prompt nativo de biometria/permissões.
const RELOCK_GRACE_MS = 800;

export function BiometricGate({ children }: { children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    const biometricEnabled = useSettingsStore((s) => s.biometricEnabled);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const clearAuth = useAuthStore((s) => s.clearAuth);

    // Bloqueio só faz sentido com biometria ligada E sessão válida.
    const gateActive = biometricEnabled && isAuthenticated;

    const [locked, setLocked] = useState(gateActive);
    const [authenticating, setAuthenticating] = useState(false);

    // Enquanto true, ignoramos o próximo ciclo background→active (o próprio prompt
    // de biometria backgrounda o app momentaneamente e não deve re-bloquear).
    const suppressLock = useRef(false);
    // Instante em que fomos para background — para o limiar RELOCK_GRACE_MS.
    const backgroundedAt = useRef<number | null>(null);

    // Sincroniza `locked` quando o gate liga/desliga (ligar biometria nas
    // Configurações não deve bloquear na hora; desligar/deslogar remove o lock).
    useEffect(() => {
        if (!gateActive) setLocked(false);
    }, [gateActive]);

    const runAuth = useCallback(async () => {
        if (authenticating) return;
        setAuthenticating(true);
        suppressLock.current = true;
        try {
            const ok = await authenticate('Desbloqueie o AEMS');
            if (ok) setLocked(false);
        } finally {
            setAuthenticating(false);
            // Pequeno atraso: o retorno ao `active` após o prompt pode chegar
            // logo depois; mantém a supressão até o AppState se estabilizar.
            setTimeout(() => {
                suppressLock.current = false;
            }, 400);
        }
    }, [authenticating]);

    // Dispara o prompt automaticamente quando entra em estado bloqueado.
    useEffect(() => {
        if (gateActive && locked && !authenticating) {
            void runAuth();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gateActive, locked]);

    // Re-bloqueio ao voltar do background.
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
            if (next === 'background' || next === 'inactive') {
                if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
                return;
            }
            if (next === 'active') {
                const awayFor =
                    backgroundedAt.current != null ? Date.now() - backgroundedAt.current : 0;
                backgroundedAt.current = null;

                if (!gateActive) return;
                // Supressão local (prompt de biometria) OU global (câmera/galeria/
                // share abriram uma activity nativa — não é o usuário saindo do app).
                if (suppressLock.current || isAppLockSuppressed()) return;
                if (awayFor < RELOCK_GRACE_MS) return;
                setLocked(true);
            }
        });
        return () => sub.remove();
    }, [gateActive]);

    const handleUsePassword = useCallback(() => {
        // Logout: RootNavigator reage ao estado e mostra o LoginScreen.
        setLocked(false);
        clearAuth();
    }, [clearAuth]);

    return (
        <View style={{ flex: 1 }}>
            {children}
            {gateActive && locked ? (
                <View
                    accessibilityViewIsModal
                    className="absolute inset-0 z-50 items-center justify-center bg-brand-black px-8"
                    style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 24 }}
                >
                    <View className="flex-1 items-center justify-center">
                        <View className="mb-6 h-20 w-20 items-center justify-center rounded-3xl bg-brand/15">
                            <Ionicons name="finger-print" size={44} color={brand.DEFAULT} />
                        </View>
                        <Text className="mb-2 font-display-bold text-2xl text-brand">
                            AEMS
                        </Text>
                        <Text className="text-center font-sans text-base text-neutral-300">
                            App bloqueado. Use sua biometria para continuar.
                        </Text>
                    </View>

                    <View className="w-full gap-3">
                        <Button
                            title="Desbloquear"
                            icon="finger-print"
                            loading={authenticating}
                            onPress={runAuth}
                            accessibilityLabel="Desbloquear com biometria"
                        />
                        <Button
                            title="Entrar com senha"
                            variant="ghost"
                            onPress={handleUsePassword}
                            accessibilityLabel="Entrar com senha"
                        />
                    </View>
                </View>
            ) : null}
        </View>
    );
}
