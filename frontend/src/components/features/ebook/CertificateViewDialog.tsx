import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, ShieldCheck, Download, Printer, X, Car } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import ebookService from '@/services/api/ebook.service'
import { serviceOrdersService } from '@/services/api/service-orders.service'
import { downloadBlob } from '@/utils/downloadBlob'
import type { Certificate } from '@/types/ebook.types'

interface CertificateViewDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    certificate: Certificate
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
    if (!value) return null
    return (
        <div className="flex gap-2">
            <span className="text-xs text-[#999999] dark:text-zinc-500 w-28 shrink-0">{label}</span>
            <span className="text-xs text-[#111111] dark:text-zinc-200 font-medium">{value}</span>
        </div>
    )
}

function WarrantyStatusBadge({ status }: { status: 'vigente' | 'vencida' }) {
    if (status === 'vigente') {
        return (
            <Badge className="text-xs font-medium bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700/50 hover:bg-green-100">
                Vigente
            </Badge>
        )
    }
    return (
        <Badge variant="outline" className="text-xs font-medium bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700/50">
            Vencida
        </Badge>
    )
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}

export function CertificateViewDialog({ open, onOpenChange, certificate: cert }: CertificateViewDialogProps) {
    const { toast } = useToast()
    const [pdfUrl, setPdfUrl] = useState<string | null>(null)
    const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
    const [loadingPdf, setLoadingPdf] = useState(false)
    const [pdfLoaded, setPdfLoaded] = useState(false)
    const [downloadingId, setDownloadingId] = useState<number | null>(null)
    const [printingId, setPrintingId] = useState<number | null>(null)

    // Load PDF when dialog opens
    const loadPdf = async () => {
        if (pdfLoaded || loadingPdf) return
        setLoadingPdf(true)
        try {
            const { blob, filename } = await ebookService.getCertificatePdf(cert.id)
            setPdfBlob(blob)
            setPdfUrl(URL.createObjectURL(blob))
            setPdfLoaded(true)
            void filename
        } catch {
            toast({ variant: 'destructive', title: 'Erro ao carregar o PDF do certificado.' })
        } finally {
            setLoadingPdf(false)
        }
    }

    // Load PDF on open
    if (open && !pdfLoaded && !loadingPdf && !pdfUrl) {
        void loadPdf()
    }

    // Vehicle history
    const { data: vehicleHistory, isLoading: historyLoading } = useQuery({
        queryKey: ['vehicle-history', cert.plate],
        queryFn: () => serviceOrdersService.getVehicleHistory(cert.plate!),
        enabled: open && !!cert.plate,
        staleTime: 1000 * 60 * 5,
    })

    const handleDownload = async () => {
        setDownloadingId(cert.id)
        try {
            if (pdfBlob) {
                downloadBlob(pdfBlob, `certificado-${cert.id}.pdf`)
            } else {
                const { blob, filename } = await ebookService.getCertificatePdf(cert.id)
                downloadBlob(blob, filename)
            }
        } catch {
            toast({ variant: 'destructive', title: 'Erro ao baixar certificado.' })
        } finally {
            setDownloadingId(null)
        }
    }

    const handlePrint = async () => {
        setPrintingId(cert.id)
        try {
            const blob = pdfBlob ?? (await ebookService.getCertificatePdf(cert.id)).blob
            const url = URL.createObjectURL(blob)
            const win = window.open(url, '_blank', 'noopener,noreferrer')
            if (win) {
                win.addEventListener('load', () => {
                    setTimeout(() => {
                        win.print()
                        URL.revokeObjectURL(url)
                    }, 500)
                })
            }
        } catch {
            toast({ variant: 'destructive', title: 'Erro ao imprimir certificado.' })
        } finally {
            setPrintingId(null)
        }
    }

    const handleClose = (nextOpen: boolean) => {
        if (!nextOpen && pdfUrl) {
            URL.revokeObjectURL(pdfUrl)
            setPdfUrl(null)
            setPdfBlob(null)
            setPdfLoaded(false)
        }
        onOpenChange(nextOpen)
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-4xl bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-[#111111] dark:text-white">
                        <ShieldCheck className="h-5 w-5 text-[#F5A800]" />
                        Certificado de Garantia
                        <WarrantyStatusBadge status={cert.warranty_status} />
                    </DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                    {/* Coluna esquerda: dados + foto assinada + histórico */}
                    <div className="space-y-4">

                        {/* Dados do certificado */}
                        <div className="rounded-xl border border-[#E8E8E8] dark:border-[#333333] p-4 space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[#999999] dark:text-zinc-500 mb-3">
                                Informações
                            </p>
                            <InfoRow label="Marca" value={cert.brand_name ?? cert.brand_code} />
                            <InfoRow label="Loja" value={cert.store_name} />
                            <InfoRow label="Cliente" value={cert.customer_name} />
                            <InfoRow label="Placa" value={cert.plate?.toUpperCase()} />
                            <InfoRow label="Modelo" value={cert.model} />
                            <InfoRow label="Cor" value={cert.color} />
                            <InfoRow label="Chassi" value={cert.chassi} />
                            <InfoRow label="Nota Fiscal" value={cert.invoice_number} />
                            <InfoRow label="Serviço" value={cert.service_name} />
                            <InfoRow label="O.S." value={cert.os_number} />
                            <InfoRow label="Emissão" value={cert.issue_date ? formatDate(cert.issue_date) : undefined} />
                            <InfoRow label="Válido até" value={cert.valid_until ? formatDate(cert.valid_until) : undefined} />
                            <InfoRow label="Garantia" value={`${cert.warranty_months} meses`} />
                            <InfoRow label="Emitido por" value={cert.created_by_name} />
                        </div>

                        {/* Foto do certificado assinado */}
                        {cert.signed_photo_url && (
                            <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-[#999999] dark:text-zinc-500">
                                    Certificado Assinado
                                </p>
                                <button
                                    type="button"
                                    onClick={() => window.open(cert.signed_photo_url!, '_blank', 'noopener,noreferrer')}
                                    className="rounded-xl overflow-hidden border border-[#E8E8E8] dark:border-[#333333] hover:border-[#F5A800] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A800]"
                                    aria-label="Ver foto do certificado assinado em tamanho completo"
                                >
                                    <img
                                        src={cert.signed_photo_url}
                                        alt="Certificado assinado"
                                        className="w-full max-h-48 object-contain bg-gray-50 dark:bg-zinc-800"
                                    />
                                </button>
                            </div>
                        )}

                        {/* Histórico do veículo */}
                        {cert.plate && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Car className="h-4 w-4 text-[#999999]" />
                                    <p className="text-xs font-semibold uppercase tracking-wide text-[#999999] dark:text-zinc-500">
                                        Histórico do Veículo — {cert.plate.toUpperCase()}
                                    </p>
                                </div>
                                {historyLoading ? (
                                    <div className="space-y-2">
                                        {[1, 2].map((i) => (
                                            <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-zinc-800 animate-pulse" />
                                        ))}
                                    </div>
                                ) : !vehicleHistory?.items.length ? (
                                    <p className="text-xs text-[#999999] dark:text-zinc-500 italic">
                                        Nenhuma O.S. anterior encontrada para esta placa.
                                    </p>
                                ) : (
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                        {[...vehicleHistory.items]
                                            .sort((a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled'))
                                            .map((item) => {
                                                const isCancelled = item.status === 'cancelled'
                                                return (
                                                    <div
                                                        key={item.id}
                                                        className={`rounded-xl border border-[#E8E8E8] dark:border-[#333333] bg-[#FAFAFA] dark:bg-[#1E1E1E] p-3 space-y-1 ${isCancelled ? 'opacity-60' : ''}`}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="flex items-center gap-1.5">
                                                                <span className="text-xs font-semibold text-[#111111] dark:text-white">
                                                                    {item.order_number}
                                                                </span>
                                                                {isCancelled && (
                                                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                                                        Cancelada
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="text-xs text-[#666666] dark:text-zinc-500 shrink-0 tabular-nums">
                                                                {item.service_date
                                                                    ? formatDate(item.service_date)
                                                                    : new Date(item.entry_time).toLocaleDateString('pt-BR')}
                                                            </span>
                                                        </div>
                                                        {item.store_name && (
                                                            <p className="text-xs text-[#666666] dark:text-zinc-400">{item.store_name}</p>
                                                        )}
                                                        {item.service_names.length > 0 && (
                                                            <ul className="space-y-0.5">
                                                                {item.service_names.map((name, idx) => (
                                                                    <li key={`${name}-${idx}`} className="text-xs text-[#666666] dark:text-zinc-400">
                                                                        • {name}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Ações */}
                        <div className="flex gap-2 flex-wrap">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handlePrint}
                                disabled={printingId === cert.id}
                                className="gap-2 border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800]"
                            >
                                {printingId === cert.id
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Printer className="h-4 w-4" />}
                                Imprimir
                            </Button>
                            <Button
                                type="button"
                                onClick={handleDownload}
                                disabled={downloadingId === cert.id}
                                className="gap-2 bg-[#F5A800] hover:bg-[#d49200] text-white font-medium"
                            >
                                {downloadingId === cert.id
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Download className="h-4 w-4" />}
                                Baixar PDF
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleClose(false)}
                                className="ml-auto gap-2 border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300"
                            >
                                <X className="h-4 w-4" />
                                Fechar
                            </Button>
                        </div>
                    </div>

                    {/* Coluna direita: preview do PDF */}
                    <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[#999999] dark:text-zinc-500">
                            Pré-visualização
                        </p>
                        <div className="rounded-xl border border-[#E8E8E8] dark:border-[#333333] overflow-hidden bg-gray-50 dark:bg-zinc-800">
                            {loadingPdf ? (
                                <div className="flex items-center justify-center h-[50vh] text-[#666666] dark:text-zinc-400">
                                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                    Carregando PDF...
                                </div>
                            ) : pdfUrl ? (
                                <iframe
                                    title="Pré-visualização do certificado"
                                    src={pdfUrl}
                                    className="w-full h-[50vh] bg-white"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-[50vh] text-sm text-[#666666] dark:text-zinc-400">
                                    Não foi possível pré-visualizar o PDF.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
