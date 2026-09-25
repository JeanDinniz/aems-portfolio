/**
 * CAM-05 (rascunho de O.S.) — persistência de UM rascunho de "Lançar O.S".
 *
 * Completa a intenção da fila offline: além das FOTOS (já persistidas na
 * `uploadQueue`), o restante do formulário (campos + ids das fotos vinculadas)
 * também precisa sobreviver a sair da tela ou fechar/reabrir o app — até o
 * usuário Salvar ou Descartar. Doc 04 §5.
 *
 * Guardamos apenas UM rascunho por vez (chave `aems_os_draft_v1`) em
 * `appStorage` (AsyncStorage) — dados não-sensíveis; NUNCA SecureStore.
 *
 * As fotos NÃO são serializadas aqui: persistimos só os ids (`osPhotoIds`/
 * `damagePhotoIds`); a foto comprimida vive na `uploadQueue` (cópia persistente
 * em disco). Ao restaurar, reconstruímos os `Photo` a partir de `getItem(id)`.
 */
import { appStorage } from '@/lib/storage';
import type { Department } from '@/types/service-order.types';

const STORAGE_KEY = 'aems_os_draft_v1';

/**
 * Campos do formulário de criação de O.S. persistidos no rascunho.
 *
 * Espelha o shape do `CreateOSForm` (RHF + Zod) da tela. Todos opcionais: o
 * rascunho pode estar parcialmente preenchido, e o `reset(form)` aceita um
 * objeto parcial (mescla com os defaults).
 */
export interface OSDraftForm {
    location_id?: number;
    is_courtesy?: boolean;
    is_return?: boolean;
    courtesy_return_set?: boolean;
    is_galpon?: boolean;
    department?: Department;
    service_date?: string;
    external_os_number?: string;
    plate?: string;
    vehicle_model?: string;
    vehicle_model_id?: number;
    vehicle_color?: string;
    consultant_id?: number;
    /** Vínculo da O.S. de origem quando Retorno (ReturnOriginPicker). */
    original_service_order_id?: number;
    items?: { service_id: number; quantity: number }[];
    notes?: string;
}

/** Rascunho completo de UMA criação de O.S. */
export interface OSDraft {
    /** Id estável do rascunho — o mesmo usado para vincular as fotos na fila. */
    osDraftId: string;
    /** Campos do formulário. */
    form: OSDraftForm;
    /** Ids das fotos da O.S. na `uploadQueue` (ordem importa). */
    osPhotoIds: string[];
    /** Ids das fotos de avaria na `uploadQueue`. */
    damagePhotoIds: string[];
    /**
     * URLs de fotos remotas da O.S. (cópia de O.S.) — já hospedadas no servidor,
     * fora da fila de upload. Reconstruídas direto da URL ao restaurar o rascunho.
     */
    osRemotePhotoUrls?: string[];
    /** URLs de fotos de avaria remotas (cópia de O.S.). */
    damageRemotePhotoUrls?: string[];
    /** Epoch ms do último autosave. */
    savedAt: number;
}

/** Grava (substitui) o rascunho atual. */
export async function saveOSDraft(draft: OSDraft): Promise<void> {
    await appStorage.set(STORAGE_KEY, draft);
}

/** Carrega o rascunho persistido (ou `null` se não houver). */
export async function loadOSDraft(): Promise<OSDraft | null> {
    return appStorage.get<OSDraft>(STORAGE_KEY);
}

/** Apaga o rascunho persistido. */
export async function clearOSDraft(): Promise<void> {
    await appStorage.remove(STORAGE_KEY);
}
