import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarX2, Users, UserX, Umbrella, UserCheck, FileText, Loader2, Camera, ImageIcon, Paperclip, X } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useStores } from '@/hooks/useStores';
import { useAuthStore } from '@/stores/auth.store';
import { useHasPermission } from '@/hooks/useMyPermissions';
import { employeesService } from '@/services/api/employees.service';
import { uploadService } from '@/services/api/upload.service';
import { CameraCapture } from '@/components/common/CameraCapture';
import { compressImage } from '@/utils/imageCompression';
import { validateImageFile } from '@/utils/fileValidation';
import { generateId } from '@/utils/generateId';
import { getApiErrorMessage } from '@/lib/api-error';
import { FAULT_TYPES } from '@/constants/employees';
import type { EmployeeDayStatusItem, DayStatus } from '@/types/employee.types';

// ─── helpers ────────────────────────────────────────────────────────────────

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

const STATUS_CONFIG: Record<DayStatus, { label: string; className: string }> = {
    presente:  { label: 'Presente',  className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
    falta:     { label: 'Falta',     className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
    ferias:    { label: 'Férias',    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
    afastado:  { label: 'Afastado', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
};

// ─── mark-fault dialog schema ────────────────────────────────────────────────

const markFaultSchema = z.object({
    fault_type: z.string().min(1, 'Tipo de falta é obrigatório'),
    days_count: z.string().optional(),
    notes: z.string().optional(),
});

type MarkFaultFormData = z.infer<typeof markFaultSchema>;

// ─── sub-components ──────────────────────────────────────────────────────────

interface MarkFaultDialogProps {
    employee: EmployeeDayStatusItem | null;
    selectedDate: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

function MarkFaultDialog({ employee, selectedDate, open, onOpenChange, onSuccess }: MarkFaultDialogProps) {
    const { toast } = useToast();

    // Anexo opcional (atestado, print de conversa): tirar foto ou escolher arquivo
    const [attachment, setAttachment] = useState<{ file: File; preview: string } | null>(null);
    const [showCamera, setShowCamera] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors },
    } = useForm<MarkFaultFormData>({
        resolver: zodResolver(markFaultSchema) as unknown as Resolver<MarkFaultFormData>,
        defaultValues: { days_count: '1' },
    });

    const faultType = watch('fault_type');

    const setAttachmentFile = (file: File) => {
        const validation = validateImageFile(file);
        if (!validation.valid) {
            toast({ variant: 'destructive', title: 'Arquivo inválido', description: validation.error });
            return;
        }
        setAttachment((prev) => {
            if (prev) URL.revokeObjectURL(prev.preview);
            return { file, preview: URL.createObjectURL(file) };
        });
    };

    const clearAttachment = () => {
        setAttachment((prev) => {
            if (prev) URL.revokeObjectURL(prev.preview);
            return null;
        });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (file) setAttachmentFile(file);
    };

    const mutation = useMutation({
        mutationFn: async (data: MarkFaultFormData) => {
            if (!employee) throw new Error('Funcionário não selecionado');

            let attachmentUrl: string | null = null;
            if (attachment) {
                const compressed = await compressImage(attachment.file, {
                    maxWidth: 1920,
                    maxHeight: 1080,
                    quality: 0.8,
                });
                attachmentUrl = await uploadService.uploadPhoto({
                    id: generateId(),
                    preview: attachment.preview,
                    compressed,
                    uploaded: false,
                    uploadProgress: 0,
                });
            }

            return employeesService.createMovement(employee.employee_id, {
                type: 'fault',
                movement_date: selectedDate,
                movement_data: {
                    fault_type: data.fault_type,
                    date: selectedDate,
                    days_count: data.days_count ? Number(data.days_count) : 1,
                },
                notes: data.notes || null,
                attachment_url: attachmentUrl,
            });
        },
        onSuccess: () => {
            toast({ title: 'Falta registrada com sucesso!' });
            reset();
            clearAttachment();
            onOpenChange(false);
            onSuccess();
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao registrar falta',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });

    const onSubmit = (data: MarkFaultFormData) => mutation.mutate(data);

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); clearAttachment(); } onOpenChange(v); }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Marcar Falta</DialogTitle>
                </DialogHeader>

                {employee && (
                    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
                        <p className="text-sm font-medium">{employee.name}</p>
                        {employee.position && (
                            <p className="text-xs text-muted-foreground">{employee.position}</p>
                        )}
                        <p className="text-xs text-muted-foreground">Data: {selectedDate}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="fault-type" className="text-sm font-medium">
                            Tipo de Falta <span className="text-red-500">*</span>
                        </label>
                        <Select
                            value={faultType || ''}
                            onValueChange={(v) => setValue('fault_type', v)}
                        >
                            <SelectTrigger id="fault-type">
                                <SelectValue placeholder="Selecione o tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                {FAULT_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.fault_type && (
                            <p className="text-sm text-red-500">{errors.fault_type.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="days-count" className="text-sm font-medium">
                            Quantidade de Dias
                        </label>
                        <Input
                            id="days-count"
                            type="number"
                            min={1}
                            {...register('days_count')}
                        />
                        {errors.days_count && (
                            <p className="text-sm text-red-500">{errors.days_count.message}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="fault-notes" className="text-sm font-medium">Observação</label>
                        <Textarea
                            id="fault-notes"
                            {...register('notes')}
                            placeholder="Observações opcionais..."
                            rows={2}
                        />
                    </div>

                    {/* Anexo opcional: foto do atestado / print de conversa */}
                    <div className="space-y-2">
                        <span className="text-sm font-medium">Anexo (opcional)</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                        {showCamera && (
                            <CameraCapture
                                onCapture={(file) => { setShowCamera(false); setAttachmentFile(file); }}
                                onCancel={() => setShowCamera(false)}
                            />
                        )}
                        {attachment ? (
                            <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border">
                                <img
                                    src={attachment.preview}
                                    alt="Anexo da falta"
                                    className="w-full h-full object-cover"
                                />
                                <button
                                    type="button"
                                    onClick={clearAttachment}
                                    aria-label="Remover anexo"
                                    className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded-full p-0.5 transition-colors"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowCamera(true)}
                                >
                                    <Camera className="h-4 w-4 mr-1.5" /> Tirar foto
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <ImageIcon className="h-4 w-4 mr-1.5" /> Escolher arquivo
                                </Button>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Ex.: foto do atestado ou print da conversa.
                        </p>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => { reset(); clearAttachment(); onOpenChange(false); }}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            disabled={mutation.isPending}
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            {mutation.isPending ? 'Registrando...' : 'Registrar Falta'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── frequency report dialog ─────────────────────────────────────────────────

function downloadBlob(data: BlobPart, fileName: string, type: string) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

function formatMonthLabel(dateIso: string): string {
    const [year, month] = dateIso.split('-');
    const d = new Date(Number(year), Number(month) - 1, 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

interface FrequencyReportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    items: EmployeeDayStatusItem[];
    date: string;
}

function FrequencyReportDialog({ open, onOpenChange, items, date }: FrequencyReportDialogProps) {
    const { toast } = useToast();
    const [employeeId, setEmployeeId] = useState<string>('');
    const [isExporting, setIsExporting] = useState(false);

    const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const monthLabel = date ? formatMonthLabel(date) : '';
    const selectedEmployee = sortedItems.find((i) => i.employee_id.toString() === employeeId);

    const handleOpenChange = (next: boolean) => {
        if (!next) setEmployeeId('');
        onOpenChange(next);
    };

    const handleGenerate = async () => {
        if (!employeeId) {
            toast({ variant: 'destructive', title: 'Selecione um funcionário.' });
            return;
        }
        setIsExporting(true);
        try {
            const blob = await employeesService.frequencyReport(Number(employeeId), date);
            const safeName = (selectedEmployee?.name ?? employeeId)
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9_-]/g, '');
            const yyyymm = date.slice(0, 7).replace('-', '');
            downloadBlob(blob, `frequencia_${safeName}_${yyyymm}.pdf`, 'application/pdf');
            handleOpenChange(false);
        } catch {
            toast({
                variant: 'destructive',
                title: 'Erro ao gerar relatório',
                description: 'Não foi possível gerar o PDF. Tente novamente.',
            });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Relatório de Frequência (PDF)</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-1">
                    <div className="space-y-1.5">
                        <Label htmlFor="freq-employee">
                            Funcionário <span className="text-red-500">*</span>
                        </Label>
                        <Select value={employeeId} onValueChange={setEmployeeId}>
                            <SelectTrigger id="freq-employee">
                                <SelectValue placeholder="Selecione o funcionário" />
                            </SelectTrigger>
                            <SelectContent>
                                {sortedItems.map((item) => (
                                    <SelectItem key={item.employee_id} value={item.employee_id.toString()}>
                                        {item.name}
                                        {item.position ? ` — ${item.position}` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {monthLabel && (
                        <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2">
                            Período coberto:{' '}
                            <span className="font-medium capitalize text-foreground">{monthLabel}</span>
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        onClick={handleGenerate}
                        disabled={isExporting || !employeeId}
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

// ─── summary card ────────────────────────────────────────────────────────────

interface SummaryCardProps {
    icon: React.ElementType;
    label: string;
    value: number;
    iconColor: string;
    bgColor: string;
}

function SummaryCard({ icon: Icon, label, value, iconColor, bgColor }: SummaryCardProps) {
    return (
        <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
            <div className={`rounded-lg p-2 ${bgColor}`}>
                <Icon className={`h-5 w-5 ${iconColor}`} />
            </div>
            <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
            </div>
        </div>
    );
}

// ─── main page ───────────────────────────────────────────────────────────────

export function DayAbsencesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { allStores } = useStores();
    const hasPermission = useHasPermission();
    const isOwner = useAuthStore((s) => s.isOwner);
    const canEdit = isOwner() || hasPermission('employees', 'edit');

    const [storeId, setStoreId] = useState<string>('');
    const [date, setDate] = useState<string>(todayIso());

    // Frequency report dialog
    const [freqReportOpen, setFreqReportOpen] = useState(false);

    // Mark fault dialog
    const [markFaultTarget, setMarkFaultTarget] = useState<EmployeeDayStatusItem | null>(null);
    const [markFaultOpen, setMarkFaultOpen] = useState(false);

    // Undo fault alert
    const [undoTarget, setUndoTarget] = useState<EmployeeDayStatusItem | null>(null);
    const [undoOpen, setUndoOpen] = useState(false);

    // Return from absence alert
    const [returnTarget, setReturnTarget] = useState<EmployeeDayStatusItem | null>(null);
    const [returnOpen, setReturnOpen] = useState(false);

    const queryKey = ['employee-day-status', storeId, date];

    const { data, isLoading } = useQuery({
        queryKey,
        queryFn: () => employeesService.dayStatus(Number(storeId), date),
        enabled: !!storeId && !!date,
        staleTime: 1000 * 60 * 2,
    });

    const deleteFaultMutation = useMutation({
        mutationFn: ({ employeeId, movementId }: { employeeId: number; movementId: number }) =>
            employeesService.deleteMovement(employeeId, movementId),
        onSuccess: () => {
            toast({ title: 'Falta desfeita com sucesso!' });
            queryClient.invalidateQueries({ queryKey });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao desfazer falta',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });

    const returnMutation = useMutation({
        mutationFn: (employeeId: number) => employeesService.returnFromAbsence(employeeId),
        onSuccess: () => {
            toast({ title: 'Retorno registrado com sucesso!' });
            queryClient.invalidateQueries({ queryKey });
            queryClient.invalidateQueries({ queryKey: ['employees'] });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao registrar retorno',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });

    const handleUndoConfirm = () => {
        if (!undoTarget?.fault_movement_id) return;
        deleteFaultMutation.mutate({
            employeeId: undoTarget.employee_id,
            movementId: undoTarget.fault_movement_id,
        });
        setUndoOpen(false);
        setUndoTarget(null);
    };

    const handleReturnConfirm = () => {
        if (!returnTarget) return;
        returnMutation.mutate(returnTarget.employee_id);
        setReturnOpen(false);
        setReturnTarget(null);
    };

    return (
        <div className="space-y-6 p-6">
            {/* Page header */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: 'rgba(245,168,0,0.12)' }}>
                        <CalendarX2 className="h-6 w-6" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold leading-tight">Faltas do Dia</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Registre e acompanhe as presenças por loja — alimenta a Equipe do Dia no Resumo Diário.
                        </p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={!storeId}
                    onClick={() => setFreqReportOpen(true)}
                    className="shrink-0 gap-1.5"
                >
                    <FileText className="h-4 w-4" />
                    Relatório Funcionário
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1 min-w-[200px]">
                    <label htmlFor="filter-store" className="text-sm font-medium">
                        Loja <span className="text-red-500">*</span>
                    </label>
                    <Select value={storeId} onValueChange={setStoreId}>
                        <SelectTrigger id="filter-store" className="w-[220px]">
                            <SelectValue placeholder="Selecione uma loja" />
                        </SelectTrigger>
                        <SelectContent>
                            {allStores.map((s) => (
                                <SelectItem key={s.id} value={s.id.toString()}>
                                    {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1">
                    <label htmlFor="filter-date" className="text-sm font-medium">Data</label>
                    <Input
                        id="filter-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-[160px]"
                    />
                </div>
            </div>

            {/* Require store selection */}
            {!storeId && (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                    <UserX className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Selecione uma loja para ver o status do dia.</p>
                </div>
            )}

            {/* Summary cards */}
            {storeId && (
                <>
                    {isLoading ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-[72px] rounded-lg" />
                            ))}
                        </div>
                    ) : data ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <SummaryCard
                                icon={UserCheck}
                                label="Presentes"
                                value={data.present}
                                iconColor="text-green-600 dark:text-green-400"
                                bgColor="bg-green-100 dark:bg-green-900/30"
                            />
                            <SummaryCard
                                icon={UserX}
                                label="Faltas"
                                value={data.faults}
                                iconColor="text-red-600 dark:text-red-400"
                                bgColor="bg-red-100 dark:bg-red-900/30"
                            />
                            <SummaryCard
                                icon={Umbrella}
                                label="Férias"
                                value={data.vacations}
                                iconColor="text-blue-600 dark:text-blue-400"
                                bgColor="bg-blue-100 dark:bg-blue-900/30"
                            />
                            <SummaryCard
                                icon={Users}
                                label="Afastados"
                                value={data.absences}
                                iconColor="text-amber-600 dark:text-amber-400"
                                bgColor="bg-amber-100 dark:bg-amber-900/30"
                            />
                        </div>
                    ) : null}

                    {/* Table */}
                    <div className="rounded-lg border border-border overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Funcionário</TableHead>
                                    <TableHead>Cargo</TableHead>
                                    <TableHead>Status</TableHead>
                                    {canEdit && <TableHead className="text-right">Ações</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    Array.from({ length: 6 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                            <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                                            {canEdit && <TableCell />}
                                        </TableRow>
                                    ))
                                ) : !data?.items.length ? (
                                    <TableRow>
                                        <TableCell colSpan={canEdit ? 4 : 3} className="text-center py-10 text-muted-foreground">
                                            Nenhum funcionário encontrado para esta loja e data.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    data.items.map((item) => {
                                        const cfg = STATUS_CONFIG[item.status];
                                        return (
                                            <TableRow key={item.employee_id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        {item.name}
                                                        {item.needs_return && (
                                                            <Badge
                                                                variant="outline"
                                                                className="text-[10px] py-0 px-1.5 border-amber-400 text-amber-600 dark:text-amber-400"
                                                            >
                                                                Cadastro desatualizado
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-muted-foreground text-sm">
                                                    {item.position || '—'}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
                                                            {cfg.label}
                                                        </span>
                                                        {item.reason && (
                                                            <span className="text-xs text-muted-foreground">
                                                                {item.reason}
                                                            </span>
                                                        )}
                                                        {item.attachment_url && (
                                                            <a
                                                                href={item.attachment_url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                title="Ver anexo (atestado/print)"
                                                                aria-label="Ver anexo da falta"
                                                                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                                            >
                                                                <Paperclip className="h-3.5 w-3.5" /> anexo
                                                            </a>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                {canEdit && (
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            {item.status === 'presente' && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                                                                    onClick={() => {
                                                                        setMarkFaultTarget(item);
                                                                        setMarkFaultOpen(true);
                                                                    }}
                                                                >
                                                                    Marcar falta
                                                                </Button>
                                                            )}
                                                            {item.status === 'falta' && item.fault_movement_id && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs"
                                                                    onClick={() => {
                                                                        setUndoTarget(item);
                                                                        setUndoOpen(true);
                                                                    }}
                                                                >
                                                                    Desfazer
                                                                </Button>
                                                            )}
                                                            {item.needs_return && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-7 text-xs border-amber-400 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
                                                                    onClick={() => {
                                                                        setReturnTarget(item);
                                                                        setReturnOpen(true);
                                                                    }}
                                                                >
                                                                    Registrar retorno
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </>
            )}

            {/* Frequency report dialog */}
            <FrequencyReportDialog
                open={freqReportOpen}
                onOpenChange={setFreqReportOpen}
                items={data?.items ?? []}
                date={date}
            />

            {/* Mark fault dialog */}
            <MarkFaultDialog
                employee={markFaultTarget}
                selectedDate={date}
                open={markFaultOpen}
                onOpenChange={setMarkFaultOpen}
                onSuccess={() => queryClient.invalidateQueries({ queryKey })}
            />

            {/* Undo fault alert dialog */}
            <AlertDialog open={undoOpen} onOpenChange={setUndoOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Desfazer falta</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja remover a falta de{' '}
                            <span className="font-semibold">{undoTarget?.name}</span> no dia {date}?
                            Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setUndoTarget(null)}>
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleUndoConfirm}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Desfazer falta
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Return from absence alert dialog */}
            <AlertDialog open={returnOpen} onOpenChange={setReturnOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Registrar retorno de afastamento</AlertDialogTitle>
                        <AlertDialogDescription>
                            Confirma o retorno de{' '}
                            <span className="font-semibold">{returnTarget?.name}</span>?
                            O status de RH será atualizado para Ativo.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setReturnTarget(null)}>
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={handleReturnConfirm}>
                            Confirmar retorno
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
