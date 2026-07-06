/**
 * Adaptado para React Native (Bloco B).
 *
 * Diferenças em relação ao web (frontend/src/types/photo.types.ts):
 * - Removida a dependência das APIs de browser `File` e `Blob` (inexistentes no RN).
 * - A foto local agora é representada por `LocalPhotoAsset` ({ uri, width?, height?, mime?, name? }),
 *   equivalente ao asset retornado por expo-camera / expo-image-picker.
 * - `file?: File`  → `asset?: LocalPhotoAsset` (arquivo/asset de origem).
 * - `compressed?: Blob` → `compressed?: LocalPhotoAsset` (resultado de expo-image-manipulator).
 * - `preview: string` continua sendo uma URI (file:// local em vez de blob:).
 * Os demais campos (id, uploaded, uploadProgress, url, error) permanecem iguais.
 */

/** Asset de imagem local no RN (câmera/galeria/compressão). */
export interface LocalPhotoAsset {
    uri: string;
    width?: number;
    height?: number;
    mime?: string;
    name?: string;
}

export interface Photo {
    id: string;
    asset?: LocalPhotoAsset; // Asset original — opcional; liberado após compressão
    preview: string; // URI de preview (arquivo local do comprimido)
    compressed?: LocalPhotoAsset; // Versão comprimida (expo-image-manipulator)
    uploaded: boolean; // Se já foi enviado ao backend
    uploadProgress: number; // 0-100
    url?: string; // URL no servidor (após upload)
    error?: string; // Erro de upload
}
