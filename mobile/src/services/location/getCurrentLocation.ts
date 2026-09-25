/**
 * getCurrentLocation — obtém a localização atual (foreground) para o Ponto
 * Eletrônico.
 *
 * Fluxo: pedir permissão de foreground → obter a posição com alta precisão →
 * devolver `{ latitude, longitude, accuracy_m? }`. Todos os erros são traduzidos
 * para mensagens claras em pt-BR e lançados como `LocationError` (a tela mostra
 * a `.message` direto ao usuário).
 *
 * Não pedimos permissão de background: a batida de ponto acontece com o app em
 * primeiro plano. Alta precisão (`Accuracy.High`) é suficiente para validar o
 * raio da loja sem custar o consumo de `BestForNavigation`.
 *
 * IMPORTANTE: `expo-location` é um módulo NATIVO — exige um novo dev/production
 * build. No Expo Go sem o binário atualizado, `requestForegroundPermissionsAsync`
 * pode não estar disponível; o erro é tratado como falha genérica.
 */
import * as Location from 'expo-location';

/** Coordenadas capturadas para a batida de ponto. */
export interface CurrentLocation {
    latitude: number;
    longitude: number;
    /** Precisão horizontal estimada em metros (quando disponível). */
    accuracy_m?: number;
}

/** Erro de localização com mensagem pronta para a UI (pt-BR). */
export class LocationError extends Error {
    /** `true` quando a permissão foi negada (a UI pode oferecer atalho para Ajustes). */
    readonly denied: boolean;

    constructor(message: string, denied = false) {
        super(message);
        this.name = 'LocationError';
        this.denied = denied;
    }
}

/** Tempo máximo (ms) aguardando um fix de GPS antes de desistir. */
const LOCATION_TIMEOUT_MS = 15_000;

/**
 * Solicita permissão de foreground e obtém a posição atual com alta precisão.
 *
 * @throws {LocationError} permissão negada, timeout de GPS ou falha genérica —
 *         sempre com uma mensagem em pt-BR pronta para exibir.
 */
export async function getCurrentLocation(): Promise<CurrentLocation> {
    let permission: Location.LocationPermissionResponse;
    try {
        permission = await Location.requestForegroundPermissionsAsync();
    } catch {
        throw new LocationError(
            'Não foi possível acessar a localização neste aparelho. Tente novamente.'
        );
    }

    if (!permission.granted) {
        throw new LocationError(
            'Permissão de localização negada. Habilite o acesso à localização nas configurações do aparelho para bater o ponto.',
            true
        );
    }

    // Corre o `getCurrentPositionAsync` contra um timeout próprio: em locais com
    // GPS fraco a chamada nativa pode ficar pendurada; preferimos um erro claro.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(
                new LocationError(
                    'Não conseguimos obter sua localização a tempo. Verifique o GPS e tente novamente.'
                )
            );
        }, LOCATION_TIMEOUT_MS);
    });

    try {
        const position = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            timeout,
        ]);

        const { latitude, longitude, accuracy } = position.coords;
        return {
            latitude,
            longitude,
            accuracy_m:
                typeof accuracy === 'number' && accuracy >= 0 ? accuracy : undefined,
        };
    } catch (error) {
        if (error instanceof LocationError) throw error;
        throw new LocationError(
            'Não foi possível obter sua localização. Verifique o GPS e tente novamente.'
        );
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}
