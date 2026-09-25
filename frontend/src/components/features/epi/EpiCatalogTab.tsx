import { useState } from 'react';
import { Loader2, MoreHorizontal, Pencil, Power } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCanDelete, useCanEdit } from '@/hooks/useMyPermissions';
import { useEpiCatalog, useEpiCatalogMutations } from '@/hooks/useEpi';
import type { EPI } from '@/types/epi.types';

export function EpiCatalogTab() {
    const canEdit = useCanEdit('epi');
    const canDelete = useCanDelete('epi');
    const { data, isLoading } = useEpiCatalog(1, false);
    const { create, update, deactivate } = useEpiCatalogMutations();

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<EPI | null>(null);
    const [name, setName] = useState('');
    const [dias, setDias] = useState('');
    const [toDeactivate, setToDeactivate] = useState<EPI | null>(null);

    const openNew = () => { setEditing(null); setName(''); setDias(''); setFormOpen(true); };
    const openEdit = (epi: EPI) => { setEditing(epi); setName(epi.name); setDias(String(epi.dias_validade)); setFormOpen(true); };

    const submit = () => {
        const payload = { name: name.trim(), dias_validade: Number(dias) };
        if (editing) {
            update.mutate({ id: editing.id, payload }, { onSuccess: () => setFormOpen(false) });
        } else {
            create.mutate(payload, { onSuccess: () => setFormOpen(false) });
        }
    };

    const items = data?.items ?? [];

    return (
        <div className="space-y-4 pt-4">
            <div className="flex justify-end">
                {canEdit && <Button onClick={openNew}>Novo EPI</Button>}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : items.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhum EPI cadastrado.</p>
            ) : (
                <div className="rounded-md border">
                    <div className="grid grid-cols-[1fr_140px_100px_60px] gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium">
                        <span>Nome</span><span>Validade (dias)</span><span>Status</span><span />
                    </div>
                    {items.map((epi) => (
                        <div key={epi.id} className="grid grid-cols-[1fr_140px_100px_60px] items-center gap-2 border-b px-4 py-2 text-sm last:border-0">
                            <span>{epi.name}</span>
                            <span>{epi.dias_validade}</span>
                            <span className={epi.is_active ? 'text-green-600' : 'text-muted-foreground'}>
                                {epi.is_active ? 'Ativo' : 'Inativo'}
                            </span>
                            <div className="flex justify-end">
                                {(canEdit || canDelete) && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" aria-label="Ações"><MoreHorizontal className="h-4 w-4" /></Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {canEdit && <DropdownMenuItem onClick={() => openEdit(epi)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
                                            {canDelete && epi.is_active && (
                                                <DropdownMenuItem onClick={() => setToDeactivate(epi)}><Power className="mr-2 h-4 w-4" />Desativar</DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={formOpen} onOpenChange={setFormOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>{editing ? 'Editar EPI' : 'Novo EPI'}</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="epi-name">Nome</Label>
                            <Input id="epi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Protetor Auricular" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="epi-dias">Validade (dias)</Label>
                            <Input id="epi-dias" type="number" min={1} value={dias} onChange={(e) => setDias(e.target.value)} placeholder="Ex: 60" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
                        <Button onClick={submit} disabled={!name.trim() || Number(dias) < 1 || create.isPending || update.isPending}>
                            {(create.isPending || update.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!toDeactivate} onOpenChange={(o) => !o && setToDeactivate(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Desativar EPI?</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{toDeactivate?.name}" deixará de aparecer nas listas. O histórico de entregas é preservado.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (toDeactivate) deactivate.mutate(toDeactivate.id); setToDeactivate(null); }}>
                            Desativar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
