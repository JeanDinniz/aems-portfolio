import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import { OpenRollButton } from '@/components/features/inventory/OpenRollButton';
import { inventoryService } from '@/services/api/inventory.service';
import { employeesService } from '@/services/api/employees.service';
import { formatMeters, formatReceiptDate } from '@/utils/filmRoll';
import type { FilmRoll, FilmType } from '@/services/api/inventory.service';

interface WithdrawalModalProps {
    open: boolean;
    onClose: () => void;
    rolls: FilmRoll[];
    filmTypes: FilmType[];
    defaultStoreId: number | null;
}

/**
 * Modal de saída avulsa: dá baixa de metros numa bobina para um funcionário
 * (ex.: pedaço de película pedido pelo instalador, descontado no fim do mês).
 * Cascata client-side sobre as bobinas já carregadas pela página:
 * Loja → Tipo → Tonalidade → Bobina → Metros → Funcionário → Motivo.
 */
export function WithdrawalModal({ open, onClose, rolls, filmTypes, defaultStoreId }: WithdrawalModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [storeId, setStoreId] = useState<number | 0>(defaultStoreId ?? 0);
    const [filmTypeId, setFilmTypeId] = useState<number | 0>(0);
    const [tonality, setTonality] = useState<string>('');
    const [rollId, setRollId] = useState<number | 0>(0);
    const [meters, setMeters] = useState<string>('');
    const [employeeId, setEmployeeId] = useState<number | 0>(0);
    const [reason, setReason] = useState<string>('');

    const availableRolls = useMemo(
        () => rolls.filter((r) => r.status !== 'esgotada'),
        [rolls]
    );

    const stores = useMemo(() => {
        const seen = new Map<number, string>();
        for (const r of availableRolls) {
            if (!seen.has(r.store_id)) seen.set(r.store_id, r.store_name ?? `Loja ${r.store_id}`);
        }
        return [...seen.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [availableRolls]);

    const storeRolls = useMemo(
        () => availableRolls.filter((r) => r.store_id === storeId),
        [availableRolls, storeId]
    );

    const storeFilmTypes = useMemo(() => {
        const ids = new Set(storeRolls.map((r) => r.film_type_id));
        return filmTypes.filter((ft) => ids.has(ft.id));
    }, [storeRolls, filmTypes]);

    const selectedFilmType = filmTypes.find((ft) => ft.id === filmTypeId);
    const isPPF = selectedFilmType?.department === 'ppf';

    const typeRolls = useMemo(
        () => storeRolls.filter((r) => r.film_type_id === filmTypeId),
        [storeRolls, filmTypeId]
    );

    const tonalities = useMemo(() => {
        const seen = new Set<string>();
        for (const r of typeRolls) {
            if (r.tonality) seen.add(r.tonality);
        }
        return [...seen].sort();
    }, [typeRolls]);

    const candidateRolls = useMemo(
        () => (isPPF ? typeRolls : typeRolls.filter((r) => (r.tonality ?? '') === tonality)),
        [typeRolls, tonality, isPPF]
    );

    const selectedRoll = candidateRolls.find((r) => r.id === rollId) ?? null;

    // Todos os instaladores ativos, de qualquer loja — quem retira pode ser
    // de outra loja ou do galpão (a loja da cascata é a da BOBINA, não a dele)
    const { data: installersData, isLoading: loadingEmployees } = useQuery({
        queryKey: ['employees-installers-all'],
        queryFn: () =>
            employeesService.list(
                { is_active: true, position: 'Instalador de Película' },
                1,
                500
            ),
        enabled: open,
        staleTime: 1000 * 60 * 5,
    });

    // Instaladores da loja da bobina primeiro, demais em seguida (com a loja no rótulo)
    const employees = useMemo(() => {
        const all = installersData?.employees ?? [];
        const own = all.filter((e) => e.store_id === storeId);
        const others = all.filter((e) => e.store_id !== storeId);
        return [...own, ...others];
    }, [installersData, storeId]);

    const metersValue = Number(meters.replace(',', '.'));
    const metersInvalid =
        meters !== '' && (!Number.isFinite(metersValue) || metersValue <= 0);
    const metersExceed =
        selectedRoll !== null && Number.isFinite(metersValue) && metersValue > selectedRoll.remaining_meters;
    const canSubmit =
        rollId !== 0 && employeeId !== 0 && meters !== '' && !metersInvalid && !metersExceed;

    const resetForm = () => {
        setStoreId(defaultStoreId ?? 0);
        setFilmTypeId(0);
        setTonality('');
        setRollId(0);
        setMeters('');
        setEmployeeId(0);
        setReason('');
    };

    const createWithdrawal = useMutation({
        mutationFn: () =>
            inventoryService.createWithdrawal({
                film_roll_id: rollId as number,
                employee_id: employeeId as number,
                meters: metersValue,
                reason: reason.trim() || undefined,
            }),
        onSuccess: (created) => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            queryClient.invalidateQueries({ queryKey: ['film-withdrawals'] });
            queryClient.invalidateQueries({ queryKey: ['film-withdrawals-summary'] });
            toast({
                title: 'Saída registrada',
                description: `${formatMeters(created.meters)} de ${created.film_type_name ?? 'película'}${created.tonality ? ` ${created.tonality}` : ''} para ${created.employee_name}`,
            });
            resetForm();
            onClose();
        },
        onError: (err: unknown) => {
            toast({
                title: 'Erro ao registrar saída',
                description: getApiErrorMessage(err),
                variant: 'destructive',
            });
        },
    });

    const handleClose = () => {
        if (createWithdrawal.isPending) return;
        resetForm();
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Scissors className="h-5 w-5 text-[#F5A800]" />
                        Registrar Saída de Película
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Loja</Label>
                        <Select
                            value={storeId ? storeId.toString() : ''}
                            onValueChange={(v) => {
                                setStoreId(Number(v));
                                setFilmTypeId(0);
                                setTonality('');
                                setRollId(0);
                                setEmployeeId(0);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione a loja" />
                            </SelectTrigger>
                            <SelectContent>
                                {stores.map((s) => (
                                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Tipo de Película</Label>
                        <Select
                            value={filmTypeId ? filmTypeId.toString() : ''}
                            onValueChange={(v) => {
                                setFilmTypeId(Number(v));
                                setTonality('');
                                setRollId(0);
                            }}
                            disabled={storeId === 0}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={storeId === 0 ? 'Selecione a loja primeiro' : 'Selecione o tipo'} />
                            </SelectTrigger>
                            <SelectContent>
                                {storeFilmTypes.map((ft) => (
                                    <SelectItem key={ft.id} value={ft.id.toString()}>{ft.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {!isPPF && (
                        <div className="space-y-1.5">
                            <Label>Tonalidade</Label>
                            <Select
                                value={tonality}
                                onValueChange={(v) => {
                                    setTonality(v);
                                    setRollId(0);
                                }}
                                disabled={filmTypeId === 0}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={filmTypeId === 0 ? 'Selecione o tipo primeiro' : 'Selecione a tonalidade'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {tonalities.map((t) => (
                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label>Bobina</Label>
                        <Select
                            value={rollId ? rollId.toString() : ''}
                            onValueChange={(v) => setRollId(Number(v))}
                            disabled={filmTypeId === 0 || (!isPPF && tonality === '')}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione a bobina" />
                            </SelectTrigger>
                            <SelectContent>
                                {candidateRolls.length === 0 ? (
                                    <div className="px-3 py-2 text-sm text-muted-foreground">
                                        Nenhuma bobina disponível
                                    </div>
                                ) : (
                                    candidateRolls.map((r) =>
                                        r.status === 'em_estoque' ? (
                                            // Bobina lacrada: TRAVADA (não selecionável) — a saída via
                                            // consume_roll seria barrada pelo backend. Abrir p/ quem tem permissão.
                                            <div
                                                key={r.id}
                                                className="flex items-center justify-between gap-2 px-2 py-1.5"
                                            >
                                                <span className="flex items-center gap-1 text-sm opacity-60">
                                                    <Lock className="h-3 w-3" />
                                                    {formatReceiptDate(r.receipt_date)} · lacrada — abra antes de usar
                                                </span>
                                                <OpenRollButton rollId={r.id} />
                                            </div>
                                        ) : (
                                            <SelectItem key={r.id} value={r.id.toString()}>
                                                {formatReceiptDate(r.receipt_date)} · restam {formatMeters(r.remaining_meters)} de {formatMeters(r.total_meters)}
                                            </SelectItem>
                                        )
                                    )
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Metros</Label>
                        <Input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            placeholder="Ex: 1,60"
                            value={meters}
                            onChange={(e) => setMeters(e.target.value)}
                        />
                        {metersExceed && selectedRoll && (
                            <p className="text-xs text-destructive">
                                A bobina possui apenas {formatMeters(selectedRoll.remaining_meters)} restantes
                            </p>
                        )}
                        {metersInvalid && (
                            <p className="text-xs text-destructive">Informe um valor maior que zero</p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label>Quem pediu</Label>
                        <Select
                            value={employeeId ? employeeId.toString() : ''}
                            onValueChange={(v) => setEmployeeId(Number(v))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={loadingEmployees ? 'Carregando...' : 'Selecione o instalador'} />
                            </SelectTrigger>
                            <SelectContent>
                                {!loadingEmployees && employees.length === 0 ? (
                                    <div className="px-3 py-2 text-sm text-muted-foreground">
                                        Nenhum instalador cadastrado
                                    </div>
                                ) : (
                                    employees.map((e) => (
                                        <SelectItem key={e.id} value={e.id.toString()}>{e.name}</SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label>Motivo <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                        <Textarea
                            placeholder="Ex: pedaço para retrabalho"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={500}
                            rows={2}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={createWithdrawal.isPending}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={() => createWithdrawal.mutate()}
                        disabled={!canSubmit || createWithdrawal.isPending}
                    >
                        {createWithdrawal.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Registrar Saída
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
