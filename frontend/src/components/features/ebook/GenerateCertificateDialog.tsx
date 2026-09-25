import { useState, useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, ShieldCheck, Download, Plus, Search, Image, X } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useCreateCertificate, useUpdateCertificate } from '@/hooks/useEbook';
import { useStores } from '@/hooks/useStores';
import { useToast } from '@/hooks/use-toast';
import ebookService from '@/services/api/ebook.service';
import { uploadService } from '@/services/api/upload.service';
import { downloadBlob } from '@/utils/downloadBlob';
import type { Certificate } from '@/types/ebook.types';
import { serviceOrdersService } from '@/services/api/service-orders.service';

// Marcas com logo embutido no certificado
const BRANDS = [
    { code: 'toyota', label: 'Toyota' },
    { code: 'byd', label: 'BYD' },
    { code: 'fiat', label: 'Fiat' },
    { code: 'hyundai', label: 'Hyundai' },
] as const;

const certificateSchema = z.object({
    brand_code: z.string().min(1, 'Selecione a marca'),
    store_id: z.string().min(1, 'Selecione a loja'),
    plate: z.string().min(1, 'Placa é obrigatória'),
    customer_name: z.string().min(1, 'Nome do cliente é obrigatório'),
    model: z.string(),
    color: z.string(),
    invoice_number: z.string().min(1, 'Nota fiscal é obrigatória'),
    chassi: z.string().min(1, 'Chassi é obrigatório'),
    service_name: z.string(),
    warranty_months: z.string(),
    issue_date: z.string(),
    os_search: z.string().optional(),
});

type CertificateFormData = z.infer<typeof certificateSchema>;

interface GenerateCertificateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** If provided, opens in edit mode instead of create mode */
    certificate?: Certificate;
}

const inputCls =
    'bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]';
const labelCls = 'text-sm font-medium text-[#111111] dark:text-zinc-200';

function todayISO(): string {
    return new Date().toISOString().split('T')[0];
}

export function GenerateCertificateDialog({ open, onOpenChange, certificate }: GenerateCertificateDialogProps) {
    const isEdit = !!certificate;
    const createCertificate = useCreateCertificate();
    const updateCertificate = useUpdateCertificate();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fluxo em 2 etapas: preenche o formulário → gera (salva) → pré-visualiza o PDF
    const [step, setStep] = useState<'form' | 'preview'>('form');
    const [cert, setCert] = useState<Certificate | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
    const [pdfName, setPdfName] = useState('certificado.pdf');
    const [loadingPdf, setLoadingPdf] = useState(false);

    // Signed photo upload state
    const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(certificate?.signed_photo_url ?? null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);

    // O.S. search
    const [osSearching, setOsSearching] = useState(false);

    // Service order id resolved from OS search
    const [resolvedOsId, setResolvedOsId] = useState<number | null>(certificate?.service_order_id ?? null);

    const {
        register,
        handleSubmit,
        control,
        watch,
        setValue,
        formState: { errors },
        reset,
    } = useForm<CertificateFormData>({
        resolver: zodResolver(certificateSchema),
        defaultValues: certificate
            ? {
                brand_code: certificate.brand_code,
                store_id: certificate.store_id ? String(certificate.store_id) : '',
                plate: certificate.plate ?? '',
                customer_name: certificate.customer_name ?? '',
                model: certificate.model ?? '',
                color: certificate.color ?? '',
                invoice_number: certificate.invoice_number ?? '',
                chassi: certificate.chassi ?? '',
                service_name: certificate.service_name ?? '',
                warranty_months: String(certificate.warranty_months ?? 12),
                issue_date: certificate.issue_date ?? todayISO(),
                os_search: certificate.os_number ?? '',
            }
            : {
                brand_code: '',
                store_id: '',
                plate: '',
                customer_name: '',
                model: '',
                color: '',
                invoice_number: '',
                chassi: '',
                service_name: '',
                warranty_months: '12',
                issue_date: todayISO(),
                os_search: '',
            },
    });

    // Lojas da marca selecionada (galpão e AEMS não emitem certificado)
    const { stores } = useStores();
    const brandCode = watch('brand_code');
    const brandStores = stores.filter(
        (s) => s.brand?.code === brandCode && !s.is_galpon_store && !s.code?.startsWith('WC')
    );

    // Libera o object URL do PDF ao trocar/desmontar
    useEffect(() => {
        return () => {
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        };
    }, [pdfUrl]);

    const resetAll = () => {
        reset();
        setStep('form');
        setCert(null);
        setPdfBlob(null);
        setPdfName('certificado.pdf');
        setSignedPhotoUrl(null);
        setResolvedOsId(null);
        setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
    };

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen) resetAll();
        onOpenChange(nextOpen);
    };

    // ── O.S. search ───────────────────────────────────────────────────────────
    const handleSearchOs = async () => {
        const query = watch('os_search')?.trim();
        if (!query) return;
        setOsSearching(true);
        try {
            const history = await serviceOrdersService.getVehicleHistory(query);
            if (history.items.length > 0) {
                const latest = history.items[0];
                if (history.plate) setValue('plate', history.plate);
                if (latest.service_names[0]) setValue('service_name', latest.service_names[0]);
                setResolvedOsId(latest.id);
                setValue('os_search', latest.order_number);
                toast({ title: 'O.S. encontrada', description: `${latest.order_number} — ${history.plate}` });
            } else {
                toast({ variant: 'destructive', title: 'O.S. não encontrada', description: 'Nenhuma ordem de serviço para essa placa ou número.' });
            }
        } catch {
            toast({ variant: 'destructive', title: 'Erro ao buscar O.S.' });
        } finally {
            setOsSearching(false);
        }
    };

    // ── Signed photo upload ───────────────────────────────────────────────────
    const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingPhoto(true);
        try {
            const url = await uploadService.uploadPhoto({
                id: `signed-${Date.now()}`,
                preview: URL.createObjectURL(file),
                compressed: file,
                uploaded: false,
                uploadProgress: 0,
            });
            setSignedPhotoUrl(url);
        } catch {
            toast({ variant: 'destructive', title: 'Erro ao enviar foto do certificado.' });
        } finally {
            setUploadingPhoto(false);
            e.target.value = '';
        }
    };

    // ── Submit ────────────────────────────────────────────────────────────────
    const onSubmit = (data: CertificateFormData) => {
        const brand = BRANDS.find((b) => b.code === data.brand_code);
        const payload = {
            brand_code: data.brand_code,
            brand_name: brand?.label,
            store_id: Number(data.store_id),
            plate: data.plate,
            model: data.model,
            color: data.color,
            customer_name: data.customer_name,
            invoice_number: data.invoice_number,
            chassi: data.chassi,
            service_name: data.service_name || undefined,
            warranty_months: data.warranty_months ? Number(data.warranty_months) : undefined,
            issue_date: data.issue_date || undefined,
            service_order_id: resolvedOsId ?? undefined,
            os_number: data.os_search || undefined,
            signed_photo_url: signedPhotoUrl ?? undefined,
        };

        const loadPdf = async (id: number) => {
            setLoadingPdf(true);
            try {
                const { blob, filename } = await ebookService.getCertificatePdf(id);
                setPdfBlob(blob);
                setPdfName(filename);
                setPdfUrl(URL.createObjectURL(blob));
            } catch {
                toast({
                    variant: 'destructive',
                    title: 'Erro ao carregar o PDF',
                    description: 'O certificado foi salvo, mas não foi possível pré-visualizar.',
                });
            } finally {
                setLoadingPdf(false);
            }
        };

        if (isEdit && certificate) {
            updateCertificate.mutate(
                { id: certificate.id, payload },
                {
                    onSuccess: async (updated) => {
                        setCert(updated);
                        setStep('preview');
                        await loadPdf(updated.id);
                    },
                }
            );
        } else {
            createCertificate.mutate(payload, {
                onSuccess: async (created) => {
                    setCert(created);
                    setStep('preview');
                    await loadPdf(created.id);
                },
            });
        }
    };

    const handleDownload = () => {
        if (pdfBlob) downloadBlob(pdfBlob, pdfName);
    };

    const handleNew = () => resetAll();

    const isMutating = createCertificate.isPending || updateCertificate.isPending;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent
                className={cn(
                    'bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]',
                    step === 'preview' ? 'sm:max-w-3xl' : 'sm:max-w-xl max-h-[90vh] overflow-y-auto'
                )}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-[#111111] dark:text-white">
                        <ShieldCheck className="h-5 w-5 text-[#F5A800]" />
                        {step === 'form'
                            ? isEdit ? 'Editar Certificado de Garantia' : 'Gerar Certificado de Garantia'
                            : 'Certificado gerado'}
                    </DialogTitle>
                    <p className="text-sm text-[#666666] dark:text-zinc-400 pt-0.5">
                        {step === 'form'
                            ? 'Certificado de Garantia'
                            : cert?.customer_name
                              ? `${cert.customer_name} · ${(cert.plate ?? '').toUpperCase()}`
                              : 'Certificado de Garantia'}
                    </p>
                </DialogHeader>

                {step === 'form' ? (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">

                        {/* ── Vincular O.S. (opcional) ── */}
                        <div className="space-y-1.5">
                            <Label htmlFor="cert-os-search" className={labelCls}>
                                Vincular O.S. (opcional)
                            </Label>
                            <div className="flex gap-2">
                                <Input
                                    id="cert-os-search"
                                    {...register('os_search')}
                                    placeholder="Placa ou número da O.S."
                                    className={cn(inputCls, 'flex-1 font-mono uppercase')}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearchOs(); } }}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleSearchOs}
                                    disabled={osSearching}
                                    className="shrink-0 border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800]"
                                >
                                    {osSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                                </Button>
                            </div>
                            <p className="text-xs text-[#999999] dark:text-zinc-500">
                                Buscar por placa pré-preenche os campos do veículo.
                            </p>
                        </div>

                        {/* Marca */}
                        <div className="space-y-1.5">
                            <label htmlFor="cert-brand" className={labelCls}>
                                Marca <span className="text-red-500">*</span>
                            </label>
                            <Controller
                                name="brand_code"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value}
                                        onValueChange={(v) => {
                                            field.onChange(v);
                                            setValue('store_id', '');
                                        }}
                                    >
                                        <SelectTrigger id="cert-brand" className={inputCls}>
                                            <SelectValue placeholder="Selecione a marca" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {BRANDS.map((b) => (
                                                <SelectItem key={b.code} value={b.code}>
                                                    {b.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            {errors.brand_code && (
                                <p className="text-sm text-red-500">{errors.brand_code.message}</p>
                            )}
                        </div>

                        {/* Loja */}
                        <div className="space-y-1.5">
                            <label htmlFor="cert-store" className={labelCls}>
                                Loja <span className="text-red-500">*</span>
                            </label>
                            <Controller
                                name="store_id"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value}
                                        onValueChange={field.onChange}
                                        disabled={!brandCode}
                                    >
                                        <SelectTrigger id="cert-store" className={inputCls}>
                                            <SelectValue
                                                placeholder={
                                                    brandCode
                                                        ? 'Selecione a loja'
                                                        : 'Escolha a marca primeiro'
                                                }
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {brandStores.map((s) => (
                                                <SelectItem key={s.id} value={String(s.id)}>
                                                    {s.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                            {errors.store_id && (
                                <p className="text-sm text-red-500">{errors.store_id.message}</p>
                            )}
                        </div>

                        {/* Placa + Cliente */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label htmlFor="cert-plate" className={labelCls}>
                                    Placa <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="cert-plate"
                                    {...register('plate')}
                                    placeholder="ABC1D23"
                                    className={`${inputCls} font-mono uppercase`}
                                />
                                {errors.plate && (
                                    <p className="text-sm text-red-500">{errors.plate.message}</p>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="cert-customer" className={labelCls}>
                                    Cliente <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="cert-customer"
                                    {...register('customer_name')}
                                    placeholder="Nome do cliente"
                                    className={inputCls}
                                />
                                {errors.customer_name && (
                                    <p className="text-sm text-red-500">{errors.customer_name.message}</p>
                                )}
                            </div>
                        </div>

                        {/* Modelo + Cor */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label htmlFor="cert-model" className={labelCls}>
                                    Modelo
                                </label>
                                <Input
                                    id="cert-model"
                                    {...register('model')}
                                    placeholder="Ex.: Corolla XEI"
                                    className={inputCls}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="cert-color" className={labelCls}>
                                    Cor
                                </label>
                                <Input
                                    id="cert-color"
                                    {...register('color')}
                                    placeholder="Ex.: Prata"
                                    className={inputCls}
                                />
                            </div>
                        </div>

                        {/* Nota Fiscal + Chassi */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label htmlFor="cert-invoice" className={labelCls}>
                                    Nota Fiscal <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="cert-invoice"
                                    {...register('invoice_number')}
                                    placeholder="Nº da NF"
                                    className={inputCls}
                                />
                                {errors.invoice_number && (
                                    <p className="text-sm text-red-500">{errors.invoice_number.message}</p>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="cert-chassi" className={labelCls}>
                                    Chassi <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="cert-chassi"
                                    {...register('chassi')}
                                    placeholder="Chassi"
                                    className={`${inputCls} font-mono`}
                                />
                                {errors.chassi && (
                                    <p className="text-sm text-red-500">{errors.chassi.message}</p>
                                )}
                            </div>
                        </div>

                        {/* Serviço + Meses de garantia */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label htmlFor="cert-service" className={labelCls}>
                                    Serviço
                                </label>
                                <Input
                                    id="cert-service"
                                    {...register('service_name')}
                                    placeholder="Ex.: Vitrificação de Pintura"
                                    className={inputCls}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label htmlFor="cert-warranty" className={labelCls}>
                                    Garantia (meses)
                                </label>
                                <Input
                                    id="cert-warranty"
                                    {...register('warranty_months')}
                                    type="number"
                                    min={1}
                                    max={120}
                                    placeholder="12"
                                    className={inputCls}
                                />
                            </div>
                        </div>

                        {/* Data de emissão */}
                        <div className="space-y-1.5">
                            <label htmlFor="cert-issue-date" className={labelCls}>
                                Data de Emissão
                            </label>
                            <Input
                                id="cert-issue-date"
                                {...register('issue_date')}
                                type="date"
                                className={inputCls}
                            />
                        </div>

                        {/* Foto do certificado assinado */}
                        <div className="space-y-1.5">
                            <p className={labelCls}>Foto do Certificado Assinado</p>
                            {signedPhotoUrl ? (
                                <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-[#D1D1D1] dark:border-[#333333] group">
                                    <img
                                        src={signedPhotoUrl}
                                        alt="Certificado assinado"
                                        className="w-full h-full object-cover"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setSignedPhotoUrl(null)}
                                        aria-label="Remover foto"
                                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploadingPhoto}
                                    className={cn(
                                        'flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed transition-colors text-sm',
                                        'border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-400',
                                        'hover:border-[#F5A800] hover:text-[#F5A800]',
                                        uploadingPhoto && 'opacity-50 cursor-not-allowed'
                                    )}
                                >
                                    {uploadingPhoto
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <Image className="h-4 w-4" />
                                    }
                                    {uploadingPhoto ? 'Enviando...' : 'Adicionar foto (opcional)'}
                                </button>
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handlePhotoSelect}
                                className="hidden"
                                aria-hidden="true"
                            />
                            <p className="text-xs text-[#999999] dark:text-zinc-500">
                                Foto da via física do certificado assinada pelo cliente.
                            </p>
                        </div>

                        <p className="text-xs text-[#999999] dark:text-zinc-500 bg-gray-50 dark:bg-zinc-800/50 border border-[#E8E8E8] dark:border-[#333333] rounded-lg px-3 py-2">
                            {isEdit
                                ? 'As alterações serão salvas no histórico e você poderá conferir o PDF atualizado.'
                                : 'Ao gerar, o certificado é salvo no histórico e aparece na tela para você conferir e baixar o PDF.'}
                        </p>

                        <DialogFooter className="gap-2 pt-1">
                            <Button
                                type="button"
                                onClick={() => handleClose(false)}
                                className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                                disabled={isMutating}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="submit"
                                disabled={isMutating}
                                className="bg-[#F5A800] hover:bg-[#d49200] text-white font-medium"
                            >
                                {isMutating ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {isEdit ? 'Salvando...' : 'Gerando...'}
                                    </>
                                ) : (
                                    <>
                                        <ShieldCheck className="mr-2 h-4 w-4" />
                                        {isEdit ? 'Salvar Alterações' : 'Gerar Certificado'}
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                ) : (
                    <div className="space-y-4 pt-1">
                        {/* Pré-visualização do PDF gerado */}
                        <div className="rounded-lg border border-[#D1D1D1] dark:border-[#333333] overflow-hidden bg-gray-100 dark:bg-[#1a1a1a]">
                            {loadingPdf ? (
                                <div className="flex items-center justify-center h-[60vh] text-[#666666] dark:text-zinc-400">
                                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                    Carregando pré-visualização...
                                </div>
                            ) : pdfUrl ? (
                                <iframe
                                    title="Pré-visualização do certificado"
                                    src={pdfUrl}
                                    className="w-full h-[60vh] bg-white"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-[60vh] text-[#666666] dark:text-zinc-400 text-sm">
                                    Não foi possível pré-visualizar. Baixe o PDF para conferir.
                                </div>
                            )}
                        </div>

                        <DialogFooter className="gap-2">
                            {!isEdit && (
                                <Button
                                    type="button"
                                    onClick={handleNew}
                                    className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent gap-2"
                                >
                                    <Plus className="h-4 w-4" />
                                    Novo certificado
                                </Button>
                            )}
                            <Button
                                type="button"
                                onClick={() => handleClose(false)}
                                className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent gap-2"
                            >
                                Fechar
                            </Button>
                            <Button
                                type="button"
                                onClick={handleDownload}
                                disabled={!pdfBlob}
                                className="bg-[#F5A800] hover:bg-[#d49200] text-white font-medium gap-2"
                            >
                                <Download className="h-4 w-4" />
                                Baixar PDF
                            </Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
