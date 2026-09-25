/**
 * CAM-01 — Captura de foto (câmera/galeria) via expo-image-picker.
 *
 * Fluxo: solicitar permissão → abrir câmera/galeria com `quality: 1`
 * (captura full; a compressão controlada acontece depois em compressPhoto.ts,
 * para evitar o pico de memória histórico) → devolver um `LocalPhotoAsset`.
 *
 * Tratamento de permissão: se negada, lançamos `PermissionDeniedError` para que
 * a UI (PhotoCapture) mostre mensagem + atalho para Ajustes (`Linking.openSettings()`).
 * Se o usuário cancelar a captura, lançamos `CaptureCancelled`.
 *
 * SDK 54: `mediaTypes` usa o array de strings novo (`['images']`), não o
 * `MediaTypeOptions` (deprecado).
 */
import * as ImagePicker from 'expo-image-picker';

import { suppressAppLock, releaseAppLock } from '@/services/biometrics';
import type { LocalPhotoAsset } from '@/types/photo.types';

/** O usuário cancelou a captura/seleção. Não é erro de verdade — fluxo normal. */
export class CaptureCancelled extends Error {
    constructor() {
        super('Captura cancelada pelo usuário.');
        this.name = 'CaptureCancelled';
    }
}

/** Permissão de câmera ou galeria negada. A UI deve oferecer atalho para Ajustes. */
export class PermissionDeniedError extends Error {
    /** `true` quando o usuário marcou "não perguntar novamente" (precisa ir aos Ajustes). */
    readonly canAskAgain: boolean;
    /** Origem da permissão negada, para mensagem específica. */
    readonly source: 'camera' | 'library';

    constructor(source: 'camera' | 'library', canAskAgain: boolean) {
        super(
            source === 'camera'
                ? 'Permissão de câmera negada.'
                : 'Permissão de acesso às fotos negada.'
        );
        this.name = 'PermissionDeniedError';
        this.source = source;
        this.canAskAgain = canAskAgain;
    }
}

function isCancelled(error: unknown): error is CaptureCancelled {
    return error instanceof CaptureCancelled;
}

/** Converte o asset do picker para o nosso `LocalPhotoAsset` interno. */
function toLocalAsset(asset: ImagePicker.ImagePickerAsset): LocalPhotoAsset {
    return {
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        mime: asset.mimeType ?? undefined,
        name: asset.fileName ?? undefined,
    };
}

/** Câmera do dispositivo a usar na captura. Default: traseira. */
export type CameraType = 'front' | 'back';

/**
 * Abre a câmera e devolve o asset capturado (sem compressão).
 *
 * @param cameraType câmera a abrir — `'front'` (selfie, usado no Ponto
 *        Eletrônico) ou `'back'` (padrão das fotos de O.S.). Omitido = traseira,
 *        preservando o comportamento dos usos existentes.
 * @throws {CaptureCancelled} se o usuário cancelar.
 * @throws {PermissionDeniedError} se a permissão de câmera for negada.
 */
export async function captureFromCamera(cameraType: CameraType = 'back'): Promise<LocalPhotoAsset> {
    // A câmera é uma activity nativa que backgrounda o app; suprime o re-bloqueio
    // biométrico no vaivém (senão a tela de digital reaparece ao confirmar a foto).
    suppressAppLock();
    try {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            throw new PermissionDeniedError('camera', permission.canAskAgain);
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 1,
            exif: false,
            allowsMultipleSelection: false,
            cameraType:
                cameraType === 'front'
                    ? ImagePicker.CameraType.front
                    : ImagePicker.CameraType.back,
        });

        if (result.canceled) throw new CaptureCancelled();
        return toLocalAsset(result.assets[0]);
    } finally {
        releaseAppLock();
    }
}

/**
 * Abre a galeria e devolve o asset escolhido (sem compressão).
 * @throws {CaptureCancelled} se o usuário cancelar.
 * @throws {PermissionDeniedError} se a permissão de galeria for negada.
 */
export async function pickFromLibrary(): Promise<LocalPhotoAsset> {
    // A galeria também abre uma activity nativa — mesma supressão do re-bloqueio.
    suppressAppLock();
    try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            throw new PermissionDeniedError('library', permission.canAskAgain);
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
            exif: false,
            allowsMultipleSelection: false,
        });

        if (result.canceled) throw new CaptureCancelled();
        return toLocalAsset(result.assets[0]);
    } finally {
        releaseAppLock();
    }
}

export { isCancelled };
