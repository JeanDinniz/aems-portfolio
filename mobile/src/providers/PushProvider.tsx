/**
 * PushProvider (PUSH-02) — dono do CICLO DE VIDA do push notification no app.
 *
 * Espelha o WebSocketProvider: montado dentro do QueryClientProvider, só instala
 * efeitos quando o usuário está autenticado e repassa `children` (sem UI).
 *
 * Responsabilidades:
 *  - Configura o handler de FOREGROUND (mostrar banner/alerta com o app aberto).
 *  - Ao autenticar: registra o device (`registerForPushNotificationsAsync`).
 *  - Listener de TOQUE (`addNotificationResponseReceivedListener`): navega para o
 *    módulo/tela conforme `data.type` (reusa a regra do deep link in-app).
 *  - COLD START por toque: `getLastNotificationResponseAsync` no mount.
 *  - Cleanup dos listeners no unmount (sem vazamento).
 *
 * Degradação graciosa: TODO o caminho de push tolera Expo Go / emulador / sem
 * permissão (o push.service retorna null sem crashar; os listeners simplesmente
 * nunca disparam). Sem `Device.isDevice` guard aqui — os listeners são baratos e
 * inofensivos; o registro real do token é guardado dentro do service.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import * as Notifications from 'expo-notifications';

import { registerForPushNotificationsAsync } from '@/services/push/push.service';
import { navigateFromPush, type PushData } from '@/services/push/pushNavigation';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';

/**
 * Handler de apresentação em foreground. Definido no escopo do módulo (uma vez):
 * com o app aberto, ainda mostramos o banner + lista + badge (sem som para não
 * ser intrusivo). Sem isso, o iOS suprime a notificação em foreground.
 */
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
    }),
});

/** Extrai `data` (tipado) do conteúdo de uma resposta de notificação. */
function dataFromResponse(response: Notifications.NotificationResponse | null): PushData | null {
    const data = response?.notification.request.content.data;
    return (data as PushData | undefined) ?? null;
}

export function PushProvider({ children }: { children: ReactNode }): ReactNode {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const pushEnabled = useSettingsStore((s) => s.pushEnabled);

    // ── Registro do device: quando o usuário fica autenticado ───────────────────
    // Respeita a preferência do usuário (Configurações → Notificações push). O
    // default de `pushEnabled` é `true`, então quem nunca mexeu segue registrando.
    // O toggle em SettingsScreen cuida do des-registro ao desligar.
    useEffect(() => {
        if (!isAuthenticated || !pushEnabled) return;
        // fire-and-forget; o service trata permissão/erros internamente.
        void registerForPushNotificationsAsync();
    }, [isAuthenticated, pushEnabled]);

    // ── Listener de toque + cold start (instalados uma vez) ─────────────────────
    // Guard para não processar o cold-start duas vezes (o listener também pode
    // pegar a mesma resposta logo após o mount em algumas plataformas).
    const handledColdStart = useRef(false);

    useEffect(() => {
        let mounted = true;

        // Cold start: app aberto a partir do toque numa notificação.
        Notifications.getLastNotificationResponseAsync()
            .then((response) => {
                if (!mounted || handledColdStart.current) return;
                if (response) {
                    handledColdStart.current = true;
                    navigateFromPush(dataFromResponse(response));
                }
            })
            .catch(() => {
                // Sem suporte (Expo Go) — ignora.
            });

        // App em background/foreground: toque numa notificação recebida.
        const sub = Notifications.addNotificationResponseReceivedListener((response) => {
            navigateFromPush(dataFromResponse(response));
        });

        return () => {
            mounted = false;
            sub.remove();
        };
    }, []);

    return <>{children}</>;
}
