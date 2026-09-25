import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useServices } from '@/hooks/useServices';
import { useUpdateServiceOrder } from '@/hooks/useServiceOrders';
import { useStoreStore } from '@/stores/store.store';
import type { ServiceOrder } from '@/types/service-order.types';

interface EditServicesModalProps {
    serviceOrder: ServiceOrder;
    open: boolean;
    onClose: () => void;
}

export function EditServicesModal({ serviceOrder, open, onClose }: EditServicesModalProps) {
    // Regra de negócio: mostrar só os serviços da MARCA da loja da O.S. (igual ao
    // QuickCreate). Resolve a marca a partir da loja da O.S. (location_id).
    const { availableStores } = useStoreStore();
    const storeBrandId =
        availableStores.find((s) => s.id === serviceOrder.location_id)?.brand_id ?? undefined;
    const { data: services, isLoading: isLoadingServices } = useServices(
        serviceOrder.department,
        storeBrandId
    );
    const updateServiceOrder = useUpdateServiceOrder();

    const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>(
        serviceOrder.items?.map((i) => i.service_id) ?? []
    );
    const [notes, setNotes] = useState(serviceOrder.notes ?? '');

    // Re-sync when the serviceOrder prop changes (e.g. different OS opened)
    useEffect(() => {
        setSelectedServiceIds(serviceOrder.items?.map((i) => i.service_id) ?? []);
        setNotes(serviceOrder.notes ?? '');
    }, [serviceOrder.id, serviceOrder.items, serviceOrder.notes]);

    // Catálogo ativo do departamento. Serviços exclusivos de cortesia só aparecem em
    // O.S. cortesia (ou se já estiverem vinculados à O.S., para permitir desmarcar).
    const catalogServices = (services ?? []).filter(
        (s) => serviceOrder.is_courtesy || !s.is_courtesy_only || selectedServiceIds.includes(s.id)
    );

    // Serviços que a O.S. já tem mas que NÃO vêm no catálogo ativo (inativos ou fora do
    // limite de busca): precisam aparecer marcados para o encarregado poder desmarcá-los
    // e trocar pelo serviço correto. Sem isso, o serviço lançado some da lista.
    const catalogIds = new Set((services ?? []).map((s) => s.id));
    const orphanServices = (serviceOrder.items ?? [])
        .filter((i) => i.service_id != null && !catalogIds.has(i.service_id))
        .filter((i, idx, arr) => arr.findIndex((x) => x.service_id === i.service_id) === idx)
        .map((i) => ({
            id: i.service_id,
            name: i.service_name || i.service_code || `Serviço #${i.service_id}`,
            code: i.service_code ?? null,
            outOfCatalog: true,
        }));

    const visibleServices: Array<{
        id: number;
        name: string;
        code?: string | null;
        outOfCatalog?: boolean;
    }> = [
        ...orphanServices,
        ...catalogServices.map((s) => ({ id: s.id, name: s.name, code: s.code })),
    ];

    const toggleService = (id: number) => {
        setSelectedServiceIds((prev) =>
            prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
        );
    };

    const handleSave = () => {
        updateServiceOrder.mutate(
            {
                id: serviceOrder.id,
                data: {
                    items: selectedServiceIds.map((id) => ({ service_id: id, quantity: 1 })),
                    notes: notes.trim() ? notes : null,
                },
            },
            {
                onSuccess: () => {
                    onClose();
                },
            }
        );
    };

    const canSave = selectedServiceIds.length > 0 && !updateServiceOrder.isPending;

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
            <DialogContent className="sm:max-w-md bg-white dark:bg-[#1E1E1E] border border-[#D1D1D1] dark:border-[#333333]">
                <DialogHeader>
                    <DialogTitle
                        className="text-base font-bold text-[#111111] dark:text-white"
                        style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                    >
                        Editar OS —{' '}
                        <span className="font-mono tracking-widest text-[#F5A800]">
                            {serviceOrder.plate}
                        </span>
                    </DialogTitle>
                </DialogHeader>

                {/* Serviços */}
                <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 mb-2">
                        Serviços
                    </p>
                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {isLoadingServices ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton
                                    key={i}
                                    className="h-8 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse rounded-md"
                                />
                            ))
                        ) : visibleServices.length === 0 ? (
                            <p className="text-sm text-[#666666] dark:text-zinc-400 py-4 text-center">
                                Nenhum serviço disponível para este departamento.
                            </p>
                        ) : (
                            visibleServices.map((service) => {
                                const checked = selectedServiceIds.includes(service.id);
                                return (
                                    <label
                                        key={service.id}
                                        className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
                                    >
                                        <Checkbox
                                            id={`service-${service.id}`}
                                            checked={checked}
                                            onCheckedChange={() => toggleService(service.id)}
                                            className="border-[#D1D1D1] dark:border-[#555555] data-[state=checked]:bg-[#F5A800] data-[state=checked]:border-[#F5A800]"
                                        />
                                        <span className="text-sm text-[#111111] dark:text-zinc-200 select-none">
                                            {service.code && service.code !== service.name
                                                ? `${service.code} - ${service.name}`
                                                : service.name}
                                            {service.outOfCatalog && (
                                                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-[#999999] dark:text-zinc-500">
                                                    (atual)
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                );
                            })
                        )}
                    </div>
                    {selectedServiceIds.length === 0 && !isLoadingServices && (
                        <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                            Selecione ao menos um serviço.
                        </p>
                    )}
                </div>

                {/* Observações */}
                <div className="mt-3">
                    <label htmlFor="edit-services-notes" className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 mb-1.5 block">
                        Observações
                    </label>
                    <Textarea
                        id="edit-services-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Observações sobre a O.S. (opcional)"
                        rows={3}
                        className="resize-none text-sm text-[#111111] dark:text-zinc-200 border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] focus:ring-[#F5A800] focus:border-[#F5A800] placeholder:text-[#999999] dark:placeholder:text-zinc-600"
                    />
                </div>

                <div className="flex justify-end gap-2 mt-4">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        disabled={updateServiceOrder.isPending}
                        className="border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 bg-transparent hover:border-[#999999]"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!canSave}
                        className="font-semibold"
                        style={{
                            backgroundColor: canSave ? '#F5A800' : undefined,
                            color: canSave ? '#111111' : undefined,
                        }}
                    >
                        {updateServiceOrder.isPending ? 'Salvando...' : 'Salvar'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
