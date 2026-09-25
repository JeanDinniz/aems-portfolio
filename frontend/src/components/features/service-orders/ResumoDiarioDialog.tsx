import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useStores } from '@/hooks/useStores';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/stores/auth.store';
import apiClient from '@/services/api/client';

interface ResumoDiarioDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Pre-fills the date input. Defaults to today. */
    defaultDate?: string;
    /** Quando true, envia only_completed=true ao backend e ajusta o nome do arquivo. Default false. */
    onlyCompleted?: boolean;
    /** Título exibido no DialogTitle. Default 'Resumo Diário (PDF)'. */
    title?: string;
}

function downloadBlob(data: BlobPart, fileName: string, type: string) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

export function ResumoDiarioDialog({
    open,
    onOpenChange,
    defaultDate,
    onlyCompleted = false,
    title = 'Resumo Diário (PDF)',
}: ResumoDiarioDialogProps) {
    const { stores } = useStores();
    const { toast } = useToast();

    // Perfil galpão só pode gerar o relatório do galpão (Galpão Central).
    const isGalponProfile =
        useAuthStore((s) => s.effectivePermissions)?.is_galpon_profile === true;
    const visibleStores = isGalponProfile ? stores.filter((s) => s.is_galpon_store) : stores;

    const today = new Date().toISOString().split('T')[0];
    const initialDate = defaultDate ?? today;

    // Pré-seleciona a loja quando o usuário só tem acesso a uma; caso
    // contrário, exige escolha no seletor do próprio diálogo.
    const initialStoreId =
        visibleStores.length === 1 ? String(visibleStores[0].id) : '';

    const [storeId, setStoreId] = useState<string>(initialStoreId);
    const [date, setDate] = useState<string>(initialDate);
    const [isExporting, setIsExporting] = useState(false);

    // Reset when dialog opens
    const handleOpenChange = (next: boolean) => {
        if (next) {
            const preselect =
                visibleStores.length === 1 ? String(visibleStores[0].id) : '';
            setStoreId(preselect);
            setDate(defaultDate ?? today);
        }
        onOpenChange(next);
    };

    const handleGenerate = async () => {
        if (!storeId) {
            toast({ variant: 'destructive', title: 'Selecione uma loja antes de gerar o PDF.' });
            return;
        }
        if (!date) {
            toast({ variant: 'destructive', title: 'Informe a data do resumo.' });
            return;
        }

        setIsExporting(true);
        try {
            const params: Record<string, unknown> = { store_id: Number(storeId), date };
            if (onlyCompleted) params.only_completed = true;

            const response = await apiClient.get('/service-orders/export/resumo-diario', {
                params,
                responseType: 'blob',
            });

            const storeName = stores.find((s) => s.id === Number(storeId))?.name ?? String(storeId);
            const safeName = storeName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
            const filePrefix = onlyCompleted ? 'resumo_diario_finalizados' : 'resumo_diario';
            downloadBlob(response.data, `${filePrefix}_${safeName}_${date}.pdf`, 'application/pdf');
            onOpenChange(false);
        } catch {
            toast({
                variant: 'destructive',
                title: 'Erro ao gerar PDF',
                description: 'Verifique se há ordens de serviço para a data e loja selecionadas.',
            });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                <DialogHeader>
                    <DialogTitle className="text-[#111111] dark:text-white">{title}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Loja */}
                    <div className="space-y-1.5">
                        <Label htmlFor="resumo-store" className="text-[#666666] dark:text-zinc-300">
                            Loja <span className="text-red-500">*</span>
                        </Label>
                        <Select value={storeId} onValueChange={setStoreId}>
                            <SelectTrigger
                                id="resumo-store"
                                className="bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800] focus:border-[#F5A800]"
                            >
                                <SelectValue placeholder="Selecione uma loja" />
                            </SelectTrigger>
                            <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-zinc-200">
                                {visibleStores.map((s) => (
                                    <SelectItem key={s.id} value={String(s.id)}>
                                        {s.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-[#999999] dark:text-zinc-500">
                            O relatório é gerado por loja específica.
                        </p>
                    </div>

                    {/* Data */}
                    <div className="space-y-1.5">
                        <Label htmlFor="resumo-date" className="text-[#666666] dark:text-zinc-300">
                            Data <span className="text-red-500">*</span>
                        </Label>
                        <input
                            id="resumo-date"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="h-9 w-full rounded-md border border-[#D1D1D1] bg-white dark:bg-[#1A1A1A] dark:border-[#333333] px-3 text-sm text-[#111111] dark:text-white focus:outline-none focus:border-[#F5A800]"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        onClick={handleGenerate}
                        disabled={isExporting || !storeId || !date}
                        className="font-semibold"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        {isExporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Gerar PDF
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
