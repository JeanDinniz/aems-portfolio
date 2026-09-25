import { useState, useEffect } from 'react'
import {
    ShieldCheck,
    Search,
    Download,
    Trash2,
    AlertCircle,
    RefreshCw,
    Loader2,
    Pencil,
    Eye,
    Printer,
    Plus,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useCertificates, useDeleteCertificate } from '@/hooks/useEbook'
import { useStoreStore } from '@/stores/store.store'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import ebookService from '@/services/api/ebook.service'
import { downloadBlob } from '@/utils/downloadBlob'
import type { Certificate } from '@/types/ebook.types'
import { GenerateCertificateDialog } from '@/components/features/ebook/GenerateCertificateDialog'
import { CertificateViewDialog } from '@/components/features/ebook/CertificateViewDialog'

const BRAND_OPTIONS = [
    { code: 'toyota', label: 'Toyota' },
    { code: 'byd', label: 'BYD' },
    { code: 'fiat', label: 'Fiat' },
    { code: 'hyundai', label: 'Hyundai' },
]

function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
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

export default function CertificatesPage() {
    const { toast } = useToast()
    const { user } = useAuth()
    const isOwner = user?.role === 'owner'
    const availableStores = useStoreStore((s) => s.availableStores)

    const [page, setPage] = useState(1)
    const [search, setSearch] = useState('')
    const [appliedSearch, setAppliedSearch] = useState('')
    const [brand, setBrand] = useState<string>('all')
    const [storeFilter, setStoreFilter] = useState<number | 'all'>('all')
    const [downloadingId, setDownloadingId] = useState<number | null>(null)
    const [confirmDelete, setConfirmDelete] = useState<Certificate | null>(null)

    // Dialog states
    const [generateOpen, setGenerateOpen] = useState(false)
    const [editingCertificate, setEditingCertificate] = useState<Certificate | null>(null)
    const [viewingCertificate, setViewingCertificate] = useState<Certificate | null>(null)
    const [printingId, setPrintingId] = useState<number | null>(null)

    // debounce da busca (400ms)
    useEffect(() => {
        const t = setTimeout(() => {
            setAppliedSearch(search)
            setPage(1)
        }, 400)
        return () => clearTimeout(t)
    }, [search])

    // reseta a página ao trocar loja/marca
    useEffect(() => {
        setPage(1)
    }, [storeFilter, brand])

    const { data, isLoading, isError, refetch } = useCertificates({
        page,
        limit: 20,
        ...(storeFilter !== 'all' && { store_id: storeFilter }),
        ...(brand !== 'all' && { brand_code: brand }),
        ...(appliedSearch.trim() && { search: appliedSearch.trim() }),
    })

    const deleteCertificate = useDeleteCertificate()

    const items = data?.items ?? []
    const totalPages = data?.pagination.total_pages ?? 1
    const total = data?.pagination.total ?? 0

    const handleDownload = async (cert: Certificate) => {
        setDownloadingId(cert.id)
        try {
            const { blob, filename } = await ebookService.getCertificatePdf(cert.id)
            downloadBlob(blob, filename)
        } catch {
            toast({
                variant: 'destructive',
                title: 'Erro ao baixar',
                description: 'Não foi possível gerar o PDF deste certificado.',
            })
        } finally {
            setDownloadingId(null)
        }
    }

    const handlePrint = async (cert: Certificate) => {
        setPrintingId(cert.id)
        try {
            const { blob } = await ebookService.getCertificatePdf(cert.id)
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
            toast({
                variant: 'destructive',
                title: 'Erro ao imprimir',
                description: 'Não foi possível abrir o PDF para impressão.',
            })
        } finally {
            setPrintingId(null)
        }
    }

    const handleConfirmDelete = () => {
        if (!confirmDelete) return
        deleteCertificate.mutate(confirmDelete.id, {
            onSettled: () => setConfirmDelete(null),
        })
    }

    return (
        <div className="pt-3 px-4 pb-8 md:pt-4 md:px-6 space-y-6">
            {/* Cabeçalho */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: 'rgba(245,168,0,0.15)' }}
                    >
                        <ShieldCheck className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Certificados Emitidos
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Histórico de certificados de garantia gerados.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        onClick={() => setGenerateOpen(true)}
                        className="gap-2 font-semibold shrink-0"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Plus className="h-4 w-4" />
                        Novo Certificado
                    </Button>
                </div>
            </div>

            {/* Filtros */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por cliente, placa ou O.S...."
                        className="pl-9 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                    />
                </div>
                {availableStores.length > 1 && (
                    <Select
                        value={storeFilter === 'all' ? 'all' : String(storeFilter)}
                        onValueChange={(v) => setStoreFilter(v === 'all' ? 'all' : Number(v))}
                    >
                        <SelectTrigger className="w-full sm:w-52 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                            <SelectValue placeholder="Todas as lojas" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as lojas</SelectItem>
                            {availableStores.map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>
                                    {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <Select value={brand} onValueChange={setBrand}>
                    <SelectTrigger className="w-full sm:w-52 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <SelectValue placeholder="Todas as marcas" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas as marcas</SelectItem>
                        {BRAND_OPTIONS.map((b) => (
                            <SelectItem key={b.code} value={b.code}>
                                {b.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Carregando */}
            {isLoading && (
                <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                    ))}
                </div>
            )}

            {/* Erro */}
            {!isLoading && isError && (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                    <AlertCircle className="h-10 w-10 text-red-400" />
                    <p className="text-sm text-[#666666] dark:text-zinc-400">
                        Erro ao carregar os certificados.
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        className="border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800]"
                    >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Tentar novamente
                    </Button>
                </div>
            )}

            {/* Vazio */}
            {!isLoading && !isError && items.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-20">
                    <ShieldCheck className="h-10 w-10 text-[#999999]/40 dark:text-zinc-400/40" />
                    <p className="text-sm text-[#666666] dark:text-zinc-500">
                        {appliedSearch || brand !== 'all'
                            ? 'Nenhum certificado encontrado para os filtros aplicados.'
                            : 'Nenhum certificado emitido ainda.'}
                    </p>
                </div>
            )}

            {/* Tabela */}
            {!isLoading && !isError && items.length > 0 && (
                <Card className="border border-[#E8E8E8] dark:border-[#333333] bg-white dark:bg-[#1A1A1A]">
                    <CardContent className="p-0 overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Data</TableHead>
                                    <TableHead>Criado por</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Placa</TableHead>
                                    <TableHead>O.S.</TableHead>
                                    <TableHead>Serviço</TableHead>
                                    <TableHead>Marca</TableHead>
                                    <TableHead>Loja</TableHead>
                                    <TableHead>Garantia</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((c) => (
                                    <TableRow key={c.id}>
                                        <TableCell className="whitespace-nowrap tabular-nums text-sm">
                                            {formatDateTime(c.created_at)}
                                        </TableCell>
                                        <TableCell className="text-sm">{c.created_by_name ?? '—'}</TableCell>
                                        <TableCell className="text-sm">{c.customer_name ?? '—'}</TableCell>
                                        <TableCell className="font-mono uppercase text-sm">
                                            {c.plate ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-sm font-mono">
                                            {c.os_number ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-sm max-w-[120px] truncate">
                                            {c.service_name ?? '—'}
                                        </TableCell>
                                        <TableCell className="text-sm">{c.brand_name ?? c.brand_code}</TableCell>
                                        <TableCell className="text-sm">{c.store_name ?? '—'}</TableCell>
                                        <TableCell>
                                            <WarrantyStatusBadge status={c.warranty_status} />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-end gap-0.5">
                                                {/* Visualizar */}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setViewingCertificate(c)}
                                                    aria-label="Visualizar certificado"
                                                    className="h-8 w-8 text-[#666666] dark:text-zinc-300 hover:text-[#F5A800]"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>

                                                {/* Editar */}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setEditingCertificate(c)}
                                                    aria-label="Editar certificado"
                                                    className="h-8 w-8 text-[#666666] dark:text-zinc-300 hover:text-[#F5A800]"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>

                                                {/* Imprimir */}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handlePrint(c)}
                                                    disabled={printingId === c.id}
                                                    aria-label="Imprimir certificado"
                                                    className="h-8 w-8 text-[#666666] dark:text-zinc-300 hover:text-[#F5A800]"
                                                >
                                                    {printingId === c.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Printer className="h-4 w-4" />
                                                    )}
                                                </Button>

                                                {/* Baixar */}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDownload(c)}
                                                    disabled={downloadingId === c.id}
                                                    aria-label="Baixar PDF"
                                                    className="h-8 gap-1.5 text-[#666666] dark:text-zinc-300 hover:text-[#F5A800]"
                                                >
                                                    {downloadingId === c.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Download className="h-4 w-4" />
                                                    )}
                                                    <span className="hidden sm:inline text-xs">PDF</span>
                                                </Button>

                                                {/* Excluir (Owner) */}
                                                {isOwner && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setConfirmDelete(c)}
                                                        aria-label="Excluir certificado"
                                                        className="h-8 w-8 text-[#666666] dark:text-zinc-300 hover:text-red-500"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Paginação */}
            {!isLoading && !isError && total > 0 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[#999999] dark:text-zinc-500 tabular-nums">
                        {total} {total === 1 ? 'certificado' : 'certificados'}
                    </p>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                className="border-[#D1D1D1] dark:border-[#333333]"
                            >
                                Anterior
                            </Button>
                            <span className="text-xs text-[#666666] dark:text-zinc-400 tabular-nums">
                                {page} / {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                className="border-[#D1D1D1] dark:border-[#333333]"
                            >
                                Próxima
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Dialog: Gerar novo certificado */}
            <GenerateCertificateDialog
                open={generateOpen}
                onOpenChange={setGenerateOpen}
            />

            {/* Dialog: Editar certificado */}
            <GenerateCertificateDialog
                open={editingCertificate !== null}
                onOpenChange={(open) => { if (!open) setEditingCertificate(null) }}
                certificate={editingCertificate ?? undefined}
            />

            {/* Dialog: Visualizar certificado */}
            {viewingCertificate && (
                <CertificateViewDialog
                    open={viewingCertificate !== null}
                    onOpenChange={(open) => { if (!open) setViewingCertificate(null) }}
                    certificate={viewingCertificate}
                />
            )}

            {/* Confirmação de exclusão (somente Owner) */}
            <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333]">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">
                            Excluir certificado?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            O certificado de <strong>{confirmDelete?.customer_name ?? 'cliente'}</strong>
                            {confirmDelete?.plate ? ` (${confirmDelete.plate.toUpperCase()})` : ''} será
                            removido do histórico. Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-[#D1D1D1] dark:border-[#333333]">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDelete}
                            disabled={deleteCertificate.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deleteCertificate.isPending ? 'Excluindo...' : 'Excluir'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
