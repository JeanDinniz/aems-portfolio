import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { inventoryService } from '@/services/api/inventory.service';
import type {
    AddServiceToFilmTypePayload,
    CreateFilmRollPayload,
    CreateFilmTypePayload,
    CreateFilmWithdrawalPayload,
    FilmDepartment,
    FilmRollListParams,
    FilmWithdrawalListParams,
    UpdateFilmRollPayload,
    UpdateFilmTypePayload,
} from '@/services/api/inventory.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Hooks de inventário (INV-01) — adaptados de
 * frontend/src/hooks + InventoryPage.tsx para o mobile.
 *
 * QueryKeys (paridade com o web):
 *  - ['inventory-rolls', params]  — lista de bobinas
 *  - ['film-types', department]   — tipos de película
 *  - ['inventory-critical', ...]  — bobinas críticas
 *
 * Mutations usam Toast do design system mobile (`.success`/`.error`) e
 * `getApiErrorMessage`. O 409 de bobinas críticas (CriticalRollsError) NÃO é
 * tratado aqui — `useCreateRoll` propaga o erro para a tela decidir entre exibir
 * mensagem ou oferecer "registrar mesmo assim" (force=true).
 */

// ─── Leitura ──────────────────────────────────────────────────────────────────

/** Bobinas filtradas (loja/galpão, departamento, status, tipo de película). */
export function useFilmRolls(params?: FilmRollListParams) {
    return useQuery({
        queryKey: ['inventory-rolls', params],
        queryFn: () => inventoryService.listRolls(params),
        select: (data) => data.items,
        staleTime: 1000 * 60,
    });
}

/** Detalhe de uma bobina (derivado da lista — o backend não tem endpoint single). */
export function useRoll(id?: number) {
    return useQuery({
        queryKey: ['inventory-roll', id],
        queryFn: () => inventoryService.getRoll(id!),
        enabled: !!id,
        staleTime: 1000 * 60,
    });
}

/** Consumos (metragem) de uma bobina. */
export function useRollConsumptions(rollId?: number) {
    return useQuery({
        queryKey: ['inventory-roll-consumptions', rollId],
        queryFn: () => inventoryService.listRollConsumptions(rollId!),
        enabled: !!rollId,
        staleTime: 1000 * 60,
    });
}

/** Tipos de película, opcionalmente por departamento. */
export function useFilmTypes(department?: FilmDepartment) {
    return useQuery({
        queryKey: ['film-types', department],
        queryFn: () => inventoryService.listFilmTypes({ department }),
        select: (data) => data.items,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * INV-07 — Bobinas em nível crítico (cor vermelha). Respeita a loja global
 * (`storeId`); `undefined` → todas as lojas acessíveis. Mesma queryKey do alerta
 * de críticas (`['inventory-critical', storeId]`) já invalidada pelas mutations.
 */
export function useCriticalRolls(storeId?: number) {
    return useQuery({
        queryKey: ['inventory-critical', storeId],
        queryFn: () => inventoryService.listCriticalRolls(storeId),
        staleTime: 1000 * 60,
    });
}

/**
 * INV-07 — Previsão (forecast) de consumo de um tipo de película numa loja.
 * Só dispara com `filmTypeId` e `storeId` definidos (o backend exige a loja).
 */
export function useForecast(filmTypeId?: number, storeId?: number) {
    return useQuery({
        queryKey: ['inventory-forecast', filmTypeId, storeId],
        queryFn: () => inventoryService.getForecast(filmTypeId!, storeId!),
        enabled: !!filmTypeId && !!storeId,
        staleTime: 1000 * 60,
    });
}

// ─── Saída avulsa (withdrawals) — leitura ────────────────────────────────────

/**
 * Lista paginada de saídas avulsas (período/loja/funcionário/tipo). `staleTime: 0`
 * (paridade com o web) porque estorno/registro devem refletir imediatamente.
 */
export function useWithdrawals(params?: FilmWithdrawalListParams) {
    return useQuery({
        queryKey: ['film-withdrawals', params],
        queryFn: () => inventoryService.listWithdrawals(params),
        staleTime: 0,
    });
}

/** Totais por funcionário no período (base do desconto mensal; exclui estornadas). */
export function useWithdrawalsSummary(
    params?: Omit<FilmWithdrawalListParams, 'page' | 'limit'>
) {
    return useQuery({
        queryKey: ['film-withdrawals-summary', params],
        queryFn: () => inventoryService.getWithdrawalsSummary(params),
        staleTime: 0,
    });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Invalida lista de bobinas + alerta de críticas + DETALHE/consumos após mutação. */
function invalidateRollQueries(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
    // Sem isto, a tela de detalhe (['inventory-roll', id]) não atualizava após
    // esgotar/restaurar/transferir — só ao voltar para a lista.
    queryClient.invalidateQueries({ queryKey: ['inventory-roll'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-roll-consumptions'] });
}

/**
 * Registra bobina. NÃO trata o 409 de bobinas críticas — propaga
 * `CriticalRollsError` para a tela oferecer "registrar mesmo assim"
 * (chamar `mutate({ payload, force: true })`). Demais erros viram Toast.
 */
export function useCreateRoll() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ payload, force }: { payload: CreateFilmRollPayload; force?: boolean }) =>
            inventoryService.createRoll(payload, force ?? false),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            toast.success('Bobina registrada com sucesso.');
        },
    });
}

/**
 * Ajusta os metros restantes de uma bobina (conferência física de estoque).
 * Requer can_edit no backend. Invalida lista/críticas/detalhe/consumos.
 */
export function useAdjustRollMeters() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({
            id,
            remaining_meters,
            note,
        }: {
            id: number;
            remaining_meters: number;
            note: string;
        }) => inventoryService.adjustRollMeters(id, { remaining_meters, note }),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            toast.success('Metros ajustados com sucesso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao ajustar metros.'));
        },
    });
}

/**
 * Edita os metadados de uma bobina (tipo, tonalidade, fornecedor, NFe, custo,
 * lote, metragem total, recebimento). Requer can_edit. Invalida as mesmas queries
 * das demais mutations de bobina.
 */
export function useUpdateRoll() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateFilmRollPayload }) =>
            inventoryService.updateRoll(id, payload),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            toast.success('Bobina atualizada com sucesso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar bobina.'));
        },
    });
}

export function useTransferRoll() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ rollId, targetStoreId }: { rollId: number; targetStoreId: number }) =>
            inventoryService.transferRoll(rollId, targetStoreId),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            toast.success('Bobina transferida com sucesso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao transferir bobina.'));
        },
    });
}

export function useExhaustRoll() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => inventoryService.exhaustRoll(id),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            toast.success('Bobina marcada como esgotada.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao esgotar bobina.'));
        },
    });
}

export function useRestoreRoll() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => inventoryService.restoreRoll(id),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            toast.success('Bobina restaurada com sucesso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao restaurar bobina.'));
        },
    });
}

/**
 * Abre uma bobina para uso (em_estoque → em_uso). Só quem tem permissão de
 * estoque (inventory can_edit) consegue — o endpoint retorna 403 caso contrário.
 * Além das queries de bobina, invalida o seletor da finalização de O.S.
 * (`film-rolls-for-os`) para a bobina recém-aberta virar selecionável na hora.
 */
export function useOpenRoll() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => inventoryService.openRoll(id),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            queryClient.invalidateQueries({ queryKey: ['film-rolls-for-os'] });
            toast.success('Bobina aberta para uso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao abrir bobina.'));
        },
    });
}

export function useDeleteRoll() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => inventoryService.deleteRoll(id),
        onSuccess: () => {
            invalidateRollQueries(queryClient);
            toast.success('Bobina excluída com sucesso.');
        },
        onError: (error: Error) => {
            // 409: bobina com consumos vinculados → mensagem do backend.
            toast.error(getApiErrorMessage(error, 'Erro ao excluir bobina.'));
        },
    });
}

// ─── Saída avulsa (withdrawals) — mutations ──────────────────────────────────

/**
 * Invalida as listas/summary de saídas + as bobinas (o registro/estorno mexe na
 * metragem restante e pode mudar a cor/críticas). Paridade com o web.
 */
function invalidateWithdrawalQueries(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['film-withdrawals'] });
    queryClient.invalidateQueries({ queryKey: ['film-withdrawals-summary'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
}

/** Registra uma saída avulsa. Sucesso/erro viram Toast. */
export function useCreateWithdrawal() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (payload: CreateFilmWithdrawalPayload) =>
            inventoryService.createWithdrawal(payload),
        onSuccess: () => {
            invalidateWithdrawalQueries(queryClient);
            toast.success('Saída registrada com sucesso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao registrar saída.'));
        },
    });
}

/** Estorno (soft) de uma saída. Requer inventory:can_delete no backend. */
export function useReverseWithdrawal() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (withdrawalId: number) => inventoryService.reverseWithdrawal(withdrawalId),
        onSuccess: () => {
            invalidateWithdrawalQueries(queryClient);
            toast.success('Saída estornada com sucesso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao estornar saída.'));
        },
    });
}

// ─── Tipos de película ─────────────────────────────────────────────────────

function invalidateFilmTypeQueries(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['film-types'] });
}

export function useCreateFilmType() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (payload: CreateFilmTypePayload) => inventoryService.createFilmType(payload),
        onSuccess: () => {
            invalidateFilmTypeQueries(queryClient);
            toast.success('Tipo de película criado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao criar tipo de película.'));
        },
    });
}

export function useUpdateFilmType() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateFilmTypePayload }) =>
            inventoryService.updateFilmType(id, payload),
        onSuccess: () => {
            invalidateFilmTypeQueries(queryClient);
            toast.success('Tipo de película atualizado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar tipo de película.'));
        },
    });
}

export function useDeleteFilmType() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => inventoryService.deleteFilmType(id),
        onSuccess: () => {
            invalidateFilmTypeQueries(queryClient);
            toast.success('Tipo de película excluído.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao excluir tipo de película.'));
        },
    });
}

export function useAddServiceToFilmType() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({
            filmTypeId,
            payload,
        }: {
            filmTypeId: number;
            payload: AddServiceToFilmTypePayload;
        }) => inventoryService.addServiceToFilmType(filmTypeId, payload),
        onSuccess: () => {
            invalidateFilmTypeQueries(queryClient);
            toast.success('Serviço vinculado ao tipo de película.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao vincular serviço.'));
        },
    });
}

export function useRemoveServiceFromFilmType() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ filmTypeId, serviceId }: { filmTypeId: number; serviceId: number }) =>
            inventoryService.removeServiceFromFilmType(filmTypeId, serviceId),
        onSuccess: () => {
            invalidateFilmTypeQueries(queryClient);
            toast.success('Serviço desvinculado do tipo de película.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao desvincular serviço.'));
        },
    });
}
