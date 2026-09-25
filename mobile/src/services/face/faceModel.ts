/**
 * faceModel — carregamento ISOLADO do modelo de embedding facial (TFLite).
 *
 * ⚠️ Ponto ÚNICO de troca de modelo. O modelo é o MobileFaceNet (~5MB, InsightFace;
 * entrada 112×112, normalização (x-127.5)/128 — ver `preprocess.ts`). Para trocar,
 * basta mudar o `require` abaixo e (se necessário) as constantes de
 * pré-processamento em `preprocess.ts`. Nada mais no app conhece o caminho/arquivo
 * do modelo. Baixe o `.tflite` com `npm run fetch:face-model` (é gitignored).
 *
 * O arquivo `.tflite` é embarcado como ASSET via `require` (o Metro reconhece a
 * extensão graças a `assetExts` no metro.config.js). O `react-native-fast-tflite`
 * copia o asset para o disco e carrega no runtime nativo.
 *
 * Degradação elegante: se o módulo nativo não existir (Expo Go, build antigo) ou
 * o modelo não carregar, expomos um erro claro em vez de quebrar o boot do app.
 * O carregamento é PREGUIÇOSO (só na primeira geração de embedding) e memoizado.
 */

import { Asset } from 'expo-asset';
import type { TensorflowModel } from 'react-native-fast-tflite';

/** Modelo indisponível (módulo nativo ausente ou falha ao carregar o .tflite). */
export class FaceModelUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FaceModelUnavailableError';
    }
}

/**
 * Asset do modelo. É a ÚNICA referência ao arquivo no app — troque aqui ao migrar
 * para o modelo pequeno de produção.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../../assets/models/mobilefacenet.tflite');

/** Promessa memoizada do modelo carregado (carrega uma vez, reusa sempre). */
let modelPromise: Promise<TensorflowModel> | null = null;

/**
 * Carrega (uma vez) e retorna o modelo TFLite. Chamadas concorrentes compartilham
 * a mesma promessa. Se o carregamento falhar, a memoização é limpa para permitir
 * nova tentativa numa próxima chamada.
 *
 * @throws {FaceModelUnavailableError} se o módulo nativo/modelo não estiver disponível.
 */
export function loadFaceModel(): Promise<TensorflowModel> {
    if (modelPromise) return modelPromise;

    modelPromise = (async () => {
        let loadTensorflowModel: typeof import('react-native-fast-tflite').loadTensorflowModel;
        try {
            // Import dinâmico: se o módulo nativo não estiver embarcado (Expo Go /
            // build antigo), falha aqui de forma controlada — não no import estático.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            ({ loadTensorflowModel } = require('react-native-fast-tflite'));
        } catch (error) {
            throw new FaceModelUnavailableError(
                `Reconhecimento facial indisponível neste build. ${errText(error)}`
            );
        }

        try {
            // Resolve o asset embarcado para um caminho file:// real. No build de
            // RELEASE o `require()` sozinho vira um nome de asset SEM esquema de
            // URL e o fast-tflite falha ("no protocol: assets_models_mobilefacenet");
            // o expo-asset copia o arquivo e devolve um `localUri` file://.
            const asset = Asset.fromModule(MODEL_ASSET);
            if (!asset.downloaded) {
                await asset.downloadAsync();
            }
            const uri = asset.localUri ?? asset.uri;
            if (!uri) {
                throw new Error('asset do modelo sem URI utilizável');
            }
            return await loadTensorflowModel({ url: uri }, []); // [] = CPU-only
        } catch (error) {
            throw new FaceModelUnavailableError(
                `Não foi possível carregar o modelo facial. ${errText(error)}`
            );
        }
    })();

    // Não deixa uma promessa REJEITADA memoizada (permite retry depois).
    modelPromise.catch(() => {
        modelPromise = null;
    });

    return modelPromise;
}

function errText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Reseta o modelo memoizado. USO EXCLUSIVO EM TESTES (para forçar recarregamento
 * entre casos). Em runtime a memoização é permanente por design.
 */
export function __resetFaceModelForTests(): void {
    modelPromise = null;
}
