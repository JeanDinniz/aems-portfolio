import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Library,
    Search,
    AlertCircle,
    RefreshCw,
    Eye,
    Download,
    Printer,
    Pencil,
    FileText,
    Filter,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { useLibraryDocuments } from '@/hooks/useEbook'
import { useHasPermission } from '@/hooks/useMyPermissions'
import type { LibraryCategory, LibraryDocument } from '@/types/ebook.types'
import { LIBRARY_CATEGORY_LABELS, LIBRARY_CATEGORIES } from '@/constants/ebook'
import { useToast } from '@/hooks/use-toast'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}

function getFileTypeLabel(fileType: string | null, fileName: string): string {
    if (!fileType) {
        const ext = fileName.split('.').pop()?.toUpperCase()
        return ext ?? 'DOC'
    }
    if (fileType.includes('pdf')) return 'PDF'
    if (fileType.includes('powerpoint') || fileType.includes('presentation')) return 'PPT'
    if (fileType.includes('word') || fileType.includes('wordprocessing')) return 'DOCX'
    if (fileType.includes('excel') || fileType.includes('spreadsheet')) return 'XLSX'
    return fileType.split('/').pop()?.toUpperCase() ?? 'DOC'
}

function getFileTypeBadgeColor(fileType: string | null, fileName: string): string {
    const label = getFileTypeLabel(fileType, fileName)
    if (label === 'PDF') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    if (label === 'PPT' || label === 'PPTX') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    if (label === 'DOCX' || label === 'DOC') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    if (label === 'XLSX' || label === 'XLS') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    return 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300'
}

function isPdf(fileType: string | null, fileName: string): boolean {
    if (fileType?.includes('pdf')) return true
    return fileName.toLowerCase().endsWith('.pdf')
}

function isImage(fileType: string | null): boolean {
    return fileType?.startsWith('image/') ?? false
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared action handlers factory — avoids duplicating logic across components
// ─────────────────────────────────────────────────────────────────────────────

function useDocumentActions(doc: LibraryDocument) {
    const { toast } = useToast()

    const handleView = () => {
        window.open(doc.file_url, '_blank', 'noopener,noreferrer')
    }

    const handleDownload = () => {
        const link = document.createElement('a')
        link.href = doc.file_url
        link.download = doc.file_name
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const handlePrint = () => {
        if (isPdf(doc.file_type, doc.file_name)) {
            const win = window.open(doc.file_url, '_blank', 'noopener,noreferrer')
            if (win) {
                win.addEventListener('load', () => {
                    setTimeout(() => win.print(), 500)
                })
            }
        } else {
            window.open(doc.file_url, '_blank', 'noopener,noreferrer')
            toast({
                title: 'Abrir e imprimir',
                description: 'O arquivo foi aberto. Use Ctrl+P (ou Cmd+P) para imprimir.',
            })
        }
    }

    return { handleView, handleDownload, handlePrint }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row actions (desktop table)
// ─────────────────────────────────────────────────────────────────────────────

interface DocumentActionsProps {
    doc: LibraryDocument
    canEdit: boolean
    onEdit: (doc: LibraryDocument) => void
}

function DocumentRowActions({ doc, canEdit, onEdit }: DocumentActionsProps) {
    const { handleView, handleDownload, handlePrint } = useDocumentActions(doc)

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex items-center justify-end gap-0.5">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleView}
                            aria-label="Visualizar documento"
                            className="h-8 w-8 text-[#666666] dark:text-zinc-400 hover:text-[#F5A800]"
                        >
                            <Eye className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Visualizar</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleDownload}
                            aria-label="Baixar documento"
                            className="h-8 w-8 text-[#666666] dark:text-zinc-400 hover:text-[#F5A800]"
                        >
                            <Download className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Baixar</TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handlePrint}
                            aria-label="Imprimir documento"
                            className="h-8 w-8 text-[#666666] dark:text-zinc-400 hover:text-[#F5A800]"
                        >
                            <Printer className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {isPdf(doc.file_type, doc.file_name)
                            ? 'Imprimir'
                            : 'Imprimir (abre o arquivo; use Ctrl+P)'}
                    </TooltipContent>
                </Tooltip>

                {canEdit && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEdit(doc)}
                                aria-label="Editar documento"
                                className="h-8 w-8 text-[#666666] dark:text-zinc-400 hover:text-[#F5A800]"
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar</TooltipContent>
                    </Tooltip>
                )}
            </div>
        </TooltipProvider>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Document card (mobile layout)
// ─────────────────────────────────────────────────────────────────────────────

function DocumentCard({ doc, canEdit, onEdit }: DocumentActionsProps) {
    const { handleView, handleDownload, handlePrint } = useDocumentActions(doc)
    const fileTypeLabel = getFileTypeLabel(doc.file_type, doc.file_name)
    const fileTypeBadgeColor = getFileTypeBadgeColor(doc.file_type, doc.file_name)

    return (
        <div className="relative bg-white dark:bg-[#1A1A1A] rounded-xl border border-[#E8E8E8] dark:border-[#333333] overflow-hidden shadow-sm">
            {/* Thumbnail — clickable, opens the file */}
            <button
                type="button"
                onClick={handleView}
                aria-label={`Visualizar ${doc.title}`}
                className="relative block w-full aspect-video bg-zinc-100 dark:bg-zinc-800 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A800] focus-visible:ring-inset"
            >
                {isImage(doc.file_type) ? (
                    <img
                        src={doc.file_url}
                        alt={doc.title}
                        className="object-cover w-full h-full"
                    />
                ) : (
                    <div className="flex items-center justify-center w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900">
                        <FileText className="w-12 h-12 text-zinc-400/60" />
                    </div>
                )}

                {/* File type badge — top-right corner */}
                <span
                    className={`absolute top-2 right-2 text-xs font-bold px-1.5 py-0.5 rounded ${fileTypeBadgeColor}`}
                >
                    {fileTypeLabel}
                </span>
            </button>

            {/* Card body */}
            <div className="p-3 space-y-2">
                {/* Title + description */}
                <div>
                    <p className="font-semibold text-sm leading-snug text-[#111111] dark:text-white line-clamp-2">
                        {doc.title}
                    </p>
                    {doc.description && (
                        <p className="mt-0.5 text-xs text-[#666666] dark:text-zinc-400 line-clamp-2">
                            {doc.description}
                        </p>
                    )}
                </div>

                {/* Category badge */}
                <Badge
                    variant="secondary"
                    className="text-xs uppercase tracking-wide"
                    style={{ backgroundColor: 'rgba(245,168,0,0.15)', color: '#B07800' }}
                >
                    {LIBRARY_CATEGORY_LABELS[doc.category]}
                </Badge>

                {/* Footer row: secondary actions + prominent download */}
                <div className="flex items-center justify-between pt-1">
                    {/* Secondary actions: print + edit (ghost, small) */}
                    <TooltipProvider delayDuration={300}>
                        <div className="flex items-center gap-0.5 -ml-1">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handlePrint}
                                        aria-label="Imprimir documento"
                                        className="h-8 w-8 text-[#999999] dark:text-zinc-500 hover:text-[#F5A800]"
                                    >
                                        <Printer className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isPdf(doc.file_type, doc.file_name)
                                        ? 'Imprimir'
                                        : 'Imprimir (abre o arquivo; use Ctrl+P)'}
                                </TooltipContent>
                            </Tooltip>

                            {canEdit && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => onEdit(doc)}
                                            aria-label="Editar documento"
                                            className="h-8 w-8 text-[#999999] dark:text-zinc-500 hover:text-[#F5A800]"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Editar</TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    </TooltipProvider>

                    {/* Prominent download button — round, orange solid */}
                    <button
                        type="button"
                        onClick={handleDownload}
                        aria-label="Baixar documento"
                        className="flex items-center justify-center w-10 h-10 rounded-full shadow-md transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A800] focus-visible:ring-offset-2"
                        style={{ backgroundColor: '#F5A800', color: '#000' }}
                    >
                        <Download className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton row (desktop table)
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonRow() {
    return (
        <TableRow>
            <TableCell><Skeleton className="h-4 w-48" /></TableCell>
            <TableCell><Skeleton className="h-5 w-20" /></TableCell>
            <TableCell><Skeleton className="h-4 w-32" /></TableCell>
            <TableCell><Skeleton className="h-4 w-16" /></TableCell>
            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
            <TableCell className="text-right"><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
        </TableRow>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton card (mobile grid)
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="bg-white dark:bg-[#1A1A1A] rounded-xl border border-[#E8E8E8] dark:border-[#333333] overflow-hidden">
            <Skeleton className="w-full aspect-video rounded-none" />
            <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <div className="flex items-center justify-between pt-1">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-10 w-10 rounded-full" />
                </div>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state (shared between table and card grid)
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
    hasFilters: boolean
}

function EmptyState({ hasFilters }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center gap-2 py-16">
            <FileText className="h-10 w-10 text-[#999999]/40 dark:text-zinc-400/40" />
            <p className="text-sm text-[#666666] dark:text-zinc-500 text-center px-4">
                {hasFilters
                    ? 'Nenhum documento encontrado para os filtros aplicados.'
                    : 'Nenhum documento cadastrado.'}
            </p>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page — Biblioteca
// ─────────────────────────────────────────────────────────────────────────────

export default function EbookListPage() {
    const navigate = useNavigate()
    const hasPermission = useHasPermission()
    const canEdit = hasPermission('ebook', 'edit')

    const [search, setSearch] = useState('')
    const [appliedSearch, setAppliedSearch] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<LibraryCategory | 'all'>('all')
    const [page, setPage] = useState(1)

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => {
            setAppliedSearch(search)
            setPage(1)
        }, 400)
        return () => clearTimeout(t)
    }, [search])

    useEffect(() => {
        setPage(1)
    }, [categoryFilter])

    const { data, isLoading, isError, refetch } = useLibraryDocuments({
        page,
        limit: 20,
        is_active: true,
        ...(categoryFilter !== 'all' && { category: categoryFilter }),
        ...(appliedSearch.trim() && { search: appliedSearch.trim() }),
    })

    const items = data?.items ?? []
    const total = data?.pagination.total ?? 0
    const totalPages = data?.pagination.total_pages ?? 1
    const hasFilters = !!(appliedSearch || categoryFilter !== 'all')

    const handleEdit = (doc: LibraryDocument) => {
        navigate('/admin/ebook', { state: { editDocumentId: doc.id } })
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
                        <Library className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Biblioteca
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Documentos operacionais e apresentações da equipe.
                        </p>
                    </div>
                </div>
            </div>

            {/* Filtros */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar documento..."
                        className="pl-9 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                    />
                </div>
                <Select
                    value={categoryFilter}
                    onValueChange={(v) => setCategoryFilter(v as LibraryCategory | 'all')}
                >
                    <SelectTrigger className="w-full sm:w-52 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                        <Filter className="h-4 w-4 mr-2 text-[#999999]" />
                        <SelectValue placeholder="Todas as categorias" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas as categorias</SelectItem>
                        {LIBRARY_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                                {LIBRARY_CATEGORY_LABELS[cat]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Estado: Erro */}
            {isError && (
                <div className="flex flex-col items-center justify-center gap-3 py-20">
                    <AlertCircle className="h-10 w-10 text-red-400" />
                    <p className="text-sm text-[#666666] dark:text-zinc-400">Erro ao carregar a biblioteca.</p>
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

            {/* ── Desktop: tabela (md+) ──────────────────────────────────── */}
            {!isError && (
                <div className="hidden md:block">
                    <Card className="border border-[#E8E8E8] dark:border-[#333333] bg-white dark:bg-[#1A1A1A]">
                        <CardContent className="p-0 overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-[#E8E8E8] dark:border-[#333333]">
                                        <TableHead className="text-[#666666] dark:text-zinc-400">Título</TableHead>
                                        <TableHead className="text-[#666666] dark:text-zinc-400">Categoria</TableHead>
                                        <TableHead className="text-[#666666] dark:text-zinc-400">Arquivo</TableHead>
                                        <TableHead className="text-[#666666] dark:text-zinc-400">Tamanho</TableHead>
                                        <TableHead className="text-[#666666] dark:text-zinc-400">Data</TableHead>
                                        <TableHead className="text-right text-[#666666] dark:text-zinc-400">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                                    ) : items.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-16">
                                                <EmptyState hasFilters={hasFilters} />
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        items.map((doc) => (
                                            <TableRow
                                                key={doc.id}
                                                className="border-[#E8E8E8] dark:border-[#333333] hover:bg-gray-50 dark:hover:bg-zinc-800/40"
                                            >
                                                <TableCell className="font-medium text-[#111111] dark:text-white max-w-xs">
                                                    <span className="line-clamp-2 text-sm">{doc.title}</span>
                                                    {doc.description && (
                                                        <span className="block text-xs text-[#999999] dark:text-zinc-500 line-clamp-1 mt-0.5">
                                                            {doc.description}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant="secondary"
                                                        className="text-xs whitespace-nowrap"
                                                        style={{ backgroundColor: 'rgba(245,168,0,0.15)', color: '#B07800' }}
                                                    >
                                                        {LIBRARY_CATEGORY_LABELS[doc.category]}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className={`text-xs font-bold px-1.5 py-0.5 rounded ${getFileTypeBadgeColor(doc.file_type, doc.file_name)}`}
                                                        >
                                                            {getFileTypeLabel(doc.file_type, doc.file_name)}
                                                        </span>
                                                        <span className="text-xs text-[#999999] dark:text-zinc-500 truncate max-w-[140px] hidden md:inline">
                                                            {doc.file_name}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm text-[#666666] dark:text-zinc-400 whitespace-nowrap tabular-nums">
                                                    {formatFileSize(doc.file_size)}
                                                </TableCell>
                                                <TableCell className="text-sm text-[#666666] dark:text-zinc-400 whitespace-nowrap tabular-nums">
                                                    {formatDate(doc.created_at)}
                                                </TableCell>
                                                <TableCell>
                                                    <DocumentRowActions
                                                        doc={doc}
                                                        canEdit={canEdit}
                                                        onEdit={handleEdit}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* ── Mobile: grid de cards (< md) ──────────────────────────── */}
            {!isError && (
                <div className="md:hidden">
                    {isLoading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
                        </div>
                    ) : items.length === 0 ? (
                        <EmptyState hasFilters={hasFilters} />
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {items.map((doc) => (
                                <DocumentCard
                                    key={doc.id}
                                    doc={doc}
                                    canEdit={canEdit}
                                    onEdit={handleEdit}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Paginação */}
            {!isLoading && !isError && total > 0 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[#999999] dark:text-zinc-500 tabular-nums">
                        {total} {total === 1 ? 'documento' : 'documentos'}
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
        </div>
    )
}
