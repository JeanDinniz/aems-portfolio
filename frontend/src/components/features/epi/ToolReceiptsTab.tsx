import { useRef, useState } from 'react';
import { Wrench, User, Store, CalendarDays, Loader2, PenLine, CheckCircle2, ImageIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SignaturePad, type SignaturePadHandle } from '@/components/features/epi/SignaturePad';
import { CompactPhotoUploader } from '@/components/features/service-orders/QuickCreateModal';
import { PhotoDialog } from '@/components/common/PhotoDialog';
import { useToolCards, useConfirmToolReceipt } from '@/hooks/useMaterialRequests';
import { useToast } from '@/hooks/use-toast';
import { uploadService } from '@/services/api/upload.service';
import type { ToolCard, ToolCardParams, ToolReceiptItemPhoto } from '@/types/materialRequest.types';
import type { Photo } from '@/types/photo.types';

function formatDateBR(dateStr: string): string {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function CardRow({ card, onConfirm }: { card: ToolCard; onConfirm: (c: ToolCard) => void }) {
    const isPending = card.status === 'pendente';
    const [viewUrl, setViewUrl] = useState<string | null>(null);

    return (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold">
                            {card.employee_name ?? `Funcionário ${card.employee_id}`}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                                <Store className="w-3 h-3" /> {card.store_name ?? `Loja ${card.store_id}`}
                            </span>
                            <span className="flex items-center gap-1">
                                <CalendarDays className="w-3 h-3" /> {formatDateBR(card.request_date)}
                            </span>
                        </div>
                    </div>
                </div>
                {isPending ? (
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200">Pendente</Badge>
                ) : (
                    <Badge className="bg-green-100 text-green-700 border-green-200">
                        Recebido{card.received_at ? ` · ${formatDateBR(card.received_at.slice(0, 10))}` : ''}
                    </Badge>
                )}
            </div>

            {/* Itens */}
            <div className="pl-1 space-y-0.5">
                {card.items.map((it) => (
                    <div key={it.id} className="flex items-center gap-1.5 text-xs text-foreground/80">
                        <Wrench className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="font-medium">{it.name}</span>
                        <span className="text-muted-foreground">× {it.quantity}</span>
                        {it.notes && <span className="text-muted-foreground italic">— {it.notes}</span>}
                        {!isPending && it.photo_url && (
                            <button
                                type="button"
                                onClick={() => setViewUrl(it.photo_url)}
                                className="ml-1 inline-flex items-center gap-0.5 text-amber-700 hover:underline"
                            >
                                <ImageIcon className="w-3 h-3" /> foto
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {isPending ? (
                <div className="flex justify-end">
                    <Button size="sm" onClick={() => onConfirm(card)} className="gap-1.5">
                        <PenLine className="w-4 h-4" />
                        Registrar recebimento
                    </Button>
                </div>
            ) : (
                card.signature_base64 && (
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={() => setViewUrl(card.signature_base64)}
                            className="text-xs text-amber-700 hover:underline flex items-center gap-1"
                        >
                            <PenLine className="w-3 h-3" /> Ver assinatura
                        </button>
                    </div>
                )
            )}

            {viewUrl && (
                <PhotoDialog url={viewUrl} open={viewUrl !== null} onClose={() => setViewUrl(null)} />
            )}
        </div>
    );
}

export function ToolReceiptsTab() {
    const [statusFilter, setStatusFilter] = useState<'todos' | 'pendente' | 'recebido'>('todos');
    const params: ToolCardParams =
        statusFilter === 'todos' ? {} : { status: statusFilter };
    const { data, isLoading } = useToolCards(params);
    const cards = data?.items ?? [];

    const confirmMutation = useConfirmToolReceipt();
    const { toast } = useToast();
    const [confirmCard, setConfirmCard] = useState<ToolCard | null>(null);
    const sigRef = useRef<SignaturePadHandle>(null);
    const [sigEmpty, setSigEmpty] = useState(true);
    const [itemPhotos, setItemPhotos] = useState<Record<number, Photo[]>>({});
    const [uploadingPhotos, setUploadingPhotos] = useState(false);

    const resetDialogState = () => {
        // Libera os object URLs de preview antes de descartar o estado.
        Object.values(itemPhotos).forEach((photos) => {
            photos.forEach((p) => URL.revokeObjectURL(p.preview));
        });
        setItemPhotos({});
        setSigEmpty(true);
    };

    const allPhotosReady =
        confirmCard !== null &&
        confirmCard.items.every((it) => (itemPhotos[it.id]?.length ?? 0) === 1);

    const handleConfirm = async () => {
        if (!confirmCard) return;
        const signature = sigRef.current?.getDataUrl();
        if (!signature) return;
        if (!allPhotosReady) return;

        setUploadingPhotos(true);
        try {
            const item_photos: ToolReceiptItemPhoto[] = [];
            for (const it of confirmCard.items) {
                const photo = itemPhotos[it.id]?.[0];
                if (!photo) throw new Error(`Faltando foto do item ${it.id}`);
                const photo_url = photo.url ?? (await uploadService.uploadPhoto(photo));
                item_photos.push({ item_id: it.id, photo_url });
            }

            confirmMutation.mutate(
                {
                    request_id: confirmCard.request_id,
                    employee_id: confirmCard.employee_id,
                    signature_base64: signature,
                    item_photos,
                },
                {
                    onSuccess: () => {
                        resetDialogState();
                        setConfirmCard(null);
                    },
                }
            );
        } catch {
            toast({
                variant: 'destructive',
                title: 'Erro ao enviar fotos',
                description: 'Não foi possível enviar as fotos dos itens. Tente novamente.',
            });
        } finally {
            setUploadingPhotos(false);
        }
    };

    const handleDialogOpenChange = (open: boolean) => {
        if (!open) {
            resetDialogState();
            setConfirmCard(null);
        }
    };

    const isBusy = confirmMutation.isPending || uploadingPhotos;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">
                    Recebimentos de ferramentas/insumos vindos dos pedidos. O funcionário confirma o
                    recebimento assinando no card.
                </p>
                <Select
                    value={statusFilter}
                    onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                >
                    <SelectTrigger className="h-9 w-40">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="pendente">Pendentes</SelectItem>
                        <SelectItem value="recebido">Recebidos</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-lg" />
                    ))}
                </div>
            ) : cards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <CheckCircle2 className="w-7 h-7 text-amber-600" />
                    </div>
                    <p className="text-base font-medium">Nenhum recebimento por aqui</p>
                    <p className="text-sm text-muted-foreground max-w-md">
                        Os cards aparecem quando uma ferramenta de um pedido é vinculada a um
                        funcionário. Vincule no módulo Pedidos de Material.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    {cards.map((c) => (
                        <CardRow
                            key={`${c.request_id}-${c.employee_id}`}
                            card={c}
                            onConfirm={(card) => {
                                resetDialogState();
                                setConfirmCard(card);
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Dialog de assinatura + fotos */}
            <Dialog open={confirmCard !== null} onOpenChange={handleDialogOpenChange}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Registrar recebimento</DialogTitle>
                    </DialogHeader>
                    {confirmCard && (
                        <div className="space-y-3">
                            <div className="text-sm text-muted-foreground">
                                <span className="font-medium text-foreground">
                                    {confirmCard.employee_name ?? `Funcionário ${confirmCard.employee_id}`}
                                </span>{' '}
                                confirma o recebimento de {confirmCard.items.length}{' '}
                                {confirmCard.items.length === 1 ? 'item' : 'itens'}.
                            </div>

                            <div className="rounded-md border bg-muted/30 p-2 space-y-3">
                                {confirmCard.items.map((it) => (
                                    <div key={it.id} className="space-y-1.5">
                                        <div className="text-xs font-medium">
                                            {it.name} × {it.quantity}
                                        </div>
                                        <CompactPhotoUploader
                                            photos={itemPhotos[it.id] ?? []}
                                            onChange={(photos) =>
                                                setItemPhotos((prev) => ({ ...prev, [it.id]: photos }))
                                            }
                                            label={`Foto — ${it.name}`}
                                        />
                                    </div>
                                ))}
                            </div>

                            <SignaturePad ref={sigRef} onEmptyChange={setSigEmpty} />
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleDialogOpenChange(false)}
                            disabled={isBusy}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            onClick={handleConfirm}
                            disabled={sigEmpty || !allPhotosReady || isBusy}
                        >
                            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirmar recebimento
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
