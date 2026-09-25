import { MaterialRequestForm } from './MaterialRequestForm';
import { useCreateMaterialRequest } from '@/hooks/useMaterialRequests';
import type { MaterialRequestsStackScreenProps } from './navigation';

/**
 * MR-02 — Criação de Pedido de Material. Delega o formulário ao
 * `MaterialRequestForm` (modo create); ao salvar, chama a mutation e volta.
 */
export function CreateMaterialRequestScreen({
    navigation,
}: MaterialRequestsStackScreenProps<'CreateMaterialRequest'>) {
    const createMutation = useCreateMaterialRequest();

    return (
        <MaterialRequestForm
            mode="create"
            saving={createMutation.isPending}
            onCancel={() => navigation.goBack()}
            onSubmit={(payload) => {
                createMutation.mutate(
                    {
                        store_id: payload.store_id,
                        request_date: payload.request_date,
                        is_galpon: payload.is_galpon,
                        notes: payload.notes,
                        film_lines: payload.film_lines,
                        tool_lines: payload.tool_lines,
                    },
                    { onSuccess: () => navigation.goBack() }
                );
            }}
        />
    );
}
