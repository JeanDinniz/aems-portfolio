import { View } from 'react-native';

import { ScreenHeader } from '@/components/common/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { MaterialRequestForm } from './MaterialRequestForm';
import { useMaterialRequest, useUpdateMaterialRequest } from '@/hooks/useMaterialRequests';
import type { MaterialRequestsStackScreenProps } from './navigation';

/**
 * MR-03 — Edição de Pedido de Material.
 *
 * Carrega o pedido pelo id e reusa o `MaterialRequestForm` em modo edit. O
 * backend NÃO edita linhas de película (só data/observações/galpão/ferramentas);
 * o formulário reflete isso (películas ficam read-only). Ao salvar, envia apenas
 * os campos editáveis via `useUpdateMaterialRequest`.
 */
export function EditMaterialRequestScreen({
    navigation,
    route,
}: MaterialRequestsStackScreenProps<'EditMaterialRequest'>) {
    const { id } = route.params;
    const { data: request, isLoading, isError, refetch } = useMaterialRequest(id);
    const updateMutation = useUpdateMaterialRequest();

    if (isLoading || (!request && !isError)) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Editar pedido" onBack={() => navigation.goBack()} />
                <View className="gap-3 p-4">
                    <Skeleton width="60%" height={20} />
                    <Skeleton width="100%" height={48} radius={12} />
                    <Skeleton width="100%" height={48} radius={12} />
                    <Skeleton width="100%" height={120} radius={16} />
                </View>
            </View>
        );
    }

    if (isError || !request) {
        return (
            <View className="flex-1 bg-neutral-50 dark:bg-dark-bg">
                <ScreenHeader title="Editar pedido" onBack={() => navigation.goBack()} />
                <ErrorState onRetry={() => void refetch()} />
            </View>
        );
    }

    return (
        <MaterialRequestForm
            mode="edit"
            initial={request}
            saving={updateMutation.isPending}
            onCancel={() => navigation.goBack()}
            onSubmit={(payload) => {
                // Película não é editável no update — só data/obs/galpão/ferramentas.
                updateMutation.mutate(
                    {
                        id,
                        payload: {
                            request_date: payload.request_date,
                            is_galpon: payload.is_galpon,
                            notes: payload.notes,
                            tool_lines: payload.tool_lines,
                        },
                    },
                    { onSuccess: () => navigation.goBack() }
                );
            }}
        />
    );
}
