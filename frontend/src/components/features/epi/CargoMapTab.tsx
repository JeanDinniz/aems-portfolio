import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EMPLOYEE_POSITIONS } from '@/constants/employees';
import { useCanDelete, useCanEdit } from '@/hooks/useMyPermissions';
import { useCargoMap, useCargoMapMutations, useEpiCatalog } from '@/hooks/useEpi';
import type { CargoEPI } from '@/types/epi.types';

const ALL = '__all__';

export function CargoMapTab() {
    const canEdit = useCanEdit('epi');
    const canDelete = useCanDelete('epi');
    const [filterCargo, setFilterCargo] = useState<string>(ALL);
    const { data, isLoading } = useCargoMap(filterCargo === ALL ? undefined : filterCargo);
    const { data: catalog } = useEpiCatalog(1, true);
    const { create, remove } = useCargoMapMutations();

    const [open, setOpen] = useState(false);
    const [cargo, setCargo] = useState('');
    const [epiId, setEpiId] = useState('');
    const [toRemove, setToRemove] = useState<CargoEPI | null>(null);

    const submit = () => {
        create.mutate(
            { cargo, epi_id: Number(epiId) },
            { onSuccess: () => { setOpen(false); setCargo(''); setEpiId(''); } },
        );
    };

    const items = data?.items ?? [];
    const epis = catalog?.items ?? [];

    return (
        <div className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="w-64">
                    <Select value={filterCargo} onValueChange={setFilterCargo}>
                        <SelectTrigger><SelectValue placeholder="Filtrar por cargo" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>Todos os cargos</SelectItem>
                            {EMPLOYEE_POSITIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                {canEdit && <Button onClick={() => setOpen(true)}>Vincular EPI</Button>}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : items.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhum vínculo cadastrado.</p>
            ) : (
                <div className="rounded-md border">
                    <div className="grid grid-cols-[1fr_1fr_60px] gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium">
                        <span>Cargo</span><span>EPI</span><span />
                    </div>
                    {items.map((m) => (
                        <div key={m.id} className="grid grid-cols-[1fr_1fr_60px] items-center gap-2 border-b px-4 py-2 text-sm last:border-0">
                            <span>{m.cargo}</span>
                            <span>{m.epi_name}</span>
                            <div className="flex justify-end">
                                {canDelete && (
                                    <Button variant="ghost" size="icon" aria-label="Remover vínculo" onClick={() => setToRemove(m)}>
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Vincular EPI a um cargo</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Cargo</Label>
                            <Select value={cargo} onValueChange={setCargo}>
                                <SelectTrigger><SelectValue placeholder="Selecione o cargo" /></SelectTrigger>
                                <SelectContent>
                                    {EMPLOYEE_POSITIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>EPI</Label>
                            <Select value={epiId} onValueChange={setEpiId}>
                                <SelectTrigger><SelectValue placeholder="Selecione o EPI" /></SelectTrigger>
                                <SelectContent>
                                    {epis.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                        <Button onClick={submit} disabled={!cargo || !epiId || create.isPending}>
                            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Vincular
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remover vínculo?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{toRemove?.cargo}" deixará de exigir "{toRemove?.epi_name}".
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (toRemove) remove.mutate(toRemove.id); setToRemove(null); }}>
                            Remover
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
