import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
    Library,
    Plus,
    Loader2,
    MoreHorizontal,
    Edit,
    EyeOff,
    Eye,
    Trash2,
    Search,
    AlertCircle,
    RefreshCw,
    FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useHasPermission } from '@/hooks/useMyPermissions'
import {
    useLibraryDocuments,
    useCreateDocument,
    useUpdateDocument,
    useDeactivateDocument,
    useHardDeleteDocument,
} from '@/hooks/useEbook'
import type { LibraryDocument, LibraryCategory, LibraryDocumentCreatePayload, LibraryDocumentUpdatePayload } from '@/types/ebook.types'
import { LIBRARY_CATEGORY_LABELS, LIBRARY_CATEGORIES } from '@/constants/ebook'
import { EbookForm } from '@/components/features/ebook/EbookForm'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null): string {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

// ─────────────────────────────────────────────────────────────────────────────
// Page component
// ─────────────────────────────────────────────────────────────────────────────

export function EbookManagementPage() {
    const hasPermission = useHasPermission()
    const canEdit = hasPermission('ebook', 'edit')
    const canDelete = hasPermission('ebook', 'delete')
    const { toast } = useToast()
    const location = useLocation()

    const [search, setSearch] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<LibraryCategory | 'all'>('all')

    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<LibraryDocument | null>(null)
    const [confirmDeactivateId, setConfirmDeactivateId] = useState<number | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

    // Support opening edit dialog from navigation state (e.g., from EbookListPage)
    useEffect(() => {
        const state = location.state as { editDocumentId?: number } | null
        if (state?.editDocumentId) {
            // Will be resolved once data loads — we'll match by id
            // Reset state to avoid re-triggering
            window.history.replaceState({}, '')
        }
    }, [location.state])

    const { data, isLoading, isError, refetch } = useLibraryDocuments({
        limit: 200,
    })

    const createMutation = useCreateDocument()
    const updateMutation = useUpdateDocument()
    const deactivateMutation = useDeactivateDocument()
    const hardDeleteMutation = useHardDeleteDocument()

    // Handle edit deep link from location state
    useEffect(() => {
        const state = location.state as { editDocumentId?: number } | null
        if (state?.editDocumentId && data?.items) {
            const doc = data.items.find((i) => i.id === state.editDocumentId)
            if (doc) {
                setEditingItem(doc)
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data])

    const items = data?.items ?? []

    const filtered = items.filter((item) => {
        const matchCat = categoryFilter === 'all' || item.category === categoryFilter
        const q = search.toLowerCase()
        const matchSearch = !q || item.title.toLowerCase().includes(q) || item.file_name.toLowerCase().includes(q)
        return matchCat && matchSearch
    })

    const handleCreate = (payload: LibraryDocumentCreatePayload | LibraryDocumentUpdatePayload) => {
        createMutation.mutate(payload as LibraryDocumentCreatePayload, {
            onSuccess: () => {
                setAddDialogOpen(false)
                toast({ title: 'Documento adicionado com sucesso.' })
            },
            onError: () => {
                toast({ variant: 'destructive', title: 'Erro ao adicionar documento.' })
            },
        })
    }

    const handleUpdate = (payload: LibraryDocumentCreatePayload | LibraryDocumentUpdatePayload) => {
        if (!editingItem) return
        updateMutation.mutate(
            { id: editingItem.id, payload: payload as LibraryDocumentUpdatePayload },
            {
                onSuccess: () => {
                    setEditingItem(null)
                    toast({ title: 'Documento atualizado com sucesso.' })
                },
                onError: () => {
                    toast({ variant: 'destructive', title: 'Erro ao atualizar documento.' })
                },
            }
        )
    }

    const handleDeactivate = (id: number) => {
        deactivateMutation.mutate(id, {
            onSuccess: () => {
                setConfirmDeactivateId(null)
                toast({ title: 'Documento desativado com sucesso.' })
            },
            onError: () => {
                toast({ variant: 'destructive', title: 'Erro ao desativar documento.' })
            },
        })
    }

    const handleReactivate = (item: LibraryDocument) => {
        updateMutation.mutate(
            { id: item.id, payload: { is_active: true } },
            {
                onSuccess: () => toast({ title: 'Documento reativado com sucesso.' }),
                onError: () => toast({ variant: 'destructive', title: 'Erro ao reativar documento.' }),
            }
        )
    }

    const handleHardDelete = (id: number) => {
        hardDeleteMutation.mutate(id, {
            onSuccess: () => {
                setConfirmDeleteId(null)
                toast({ title: 'Documento excluído permanentemente.' })
            },
            onError: () => {
                toast({ variant: 'destructive', title: 'Não foi possível excluir o documento.' })
            },
        })
    }

    const confirmDeactivateItem = items.find((i) => i.id === confirmDeactivateId)
    const confirmDeleteItem = items.find((i) => i.id === confirmDeleteId)

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">

            {/* Cabeçalho */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: 'rgba(245,168,0,0.15)' }}>
                        <Library className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Gerenciar Biblioteca
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Documentos e apresentações da equipe.
                        </p>
                    </div>
                </div>
                {canEdit && (
                    <Button
                        onClick={() => setAddDialogOpen(true)}
                        className="font-semibold shrink-0"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Novo Documento
                    </Button>
                )}
            </div>

            {/* Filtros */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#999999] dark:text-zinc-500 pointer-events-none" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por título ou nome do arquivo..."
                        className="pl-9 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                    />
                </div>
                <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as LibraryCategory | 'all')}>
                    <SelectTrigger className="w-full sm:w-52 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
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

            {/* Conteúdo */}
            {isLoading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="h-6 w-6 animate-spin text-[#999999] dark:text-zinc-400" />
                </div>
            ) : isError ? (
                <div className="flex flex-col items-center justify-center h-40 gap-3">
                    <AlertCircle className="h-8 w-8 text-red-400" />
                    <p className="text-sm text-[#666666] dark:text-zinc-400">Erro ao carregar documentos.</p>
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
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <FileText className="h-10 w-10 text-[#999999]/40 dark:text-zinc-400/40" />
                    <p className="text-sm text-[#666666] dark:text-zinc-500">
                        {search || categoryFilter !== 'all' ? 'Nenhum documento encontrado.' : 'Nenhum documento cadastrado.'}
                    </p>
                </div>
            ) : (
                <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                    {/* Header da tabela */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-2 bg-gray-50 dark:bg-zinc-800/60 border-b border-[#D1D1D1] dark:border-[#333333]">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400">Documento</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-36 text-center hidden sm:block">Categoria</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-20 text-center hidden md:block">Tipo</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-20 text-center">Status</span>
                        {(canEdit || canDelete) && (
                            <span className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400 w-12 text-center">Ações</span>
                        )}
                    </div>

                    <div className="divide-y divide-[#E8E8E8] dark:divide-[#333333]">
                        {filtered.map((item) => (
                            <div
                                key={item.id}
                                className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
                            >
                                <div className="min-w-0 pr-2">
                                    <span className="text-sm font-medium text-[#111111] dark:text-zinc-200 truncate block">
                                        {item.title}
                                    </span>
                                    <span className="text-xs text-[#999999] dark:text-zinc-500 truncate block mt-0.5">
                                        {item.file_name} · {formatFileSize(item.file_size)}
                                    </span>
                                </div>

                                <div className="w-36 text-center hidden sm:flex justify-center">
                                    <Badge
                                        variant="secondary"
                                        className="text-xs"
                                        style={{ backgroundColor: 'rgba(245,168,0,0.15)', color: '#B07800' }}
                                    >
                                        {LIBRARY_CATEGORY_LABELS[item.category]}
                                    </Badge>
                                </div>

                                <div className="w-20 flex justify-center hidden md:flex">
                                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-300">
                                        {getFileTypeLabel(item.file_type, item.file_name)}
                                    </span>
                                </div>

                                <div className="w-20 flex justify-center">
                                    {item.is_active ? (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700/50">
                                            Ativo
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-[#666666] dark:text-zinc-400 border border-[#D1D1D1] dark:border-zinc-700">
                                            Inativo
                                        </span>
                                    )}
                                </div>

                                {(canEdit || canDelete) && (
                                    <div className="w-12 flex items-center justify-center">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" aria-label="Ações" className="text-[#F5A800]">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {canEdit && (
                                                    <DropdownMenuItem onClick={() => setEditingItem(item)}>
                                                        <Edit className="h-4 w-4 mr-2" />
                                                        Editar
                                                    </DropdownMenuItem>
                                                )}
                                                {canEdit && (
                                                    item.is_active ? (
                                                        <DropdownMenuItem
                                                            onClick={() => setConfirmDeactivateId(item.id)}
                                                            className="ring-1 ring-[#F5A800] ring-inset rounded-sm"
                                                        >
                                                            <EyeOff className="h-4 w-4 mr-2" />
                                                            Desativar
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem onClick={() => handleReactivate(item)}>
                                                            <Eye className="h-4 w-4 mr-2 text-green-600" />
                                                            <span className="text-green-600">Ativar</span>
                                                        </DropdownMenuItem>
                                                    )
                                                )}
                                                {canDelete && (
                                                    <DropdownMenuItem
                                                        onClick={() => setConfirmDeleteId(item.id)}
                                                        className="text-red-600 focus:text-red-600"
                                                    >
                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                        Excluir Permanentemente
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Dialog: Novo Documento */}
            <Dialog
                open={addDialogOpen}
                onOpenChange={(open) => {
                    if (!open) setAddDialogOpen(false)
                }}
            >
                <DialogContent className="max-w-lg bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Novo Documento</DialogTitle>
                    </DialogHeader>
                    <EbookForm
                        isPending={createMutation.isPending}
                        onSubmit={handleCreate}
                        onCancel={() => setAddDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>

            {/* Dialog: Editar Documento */}
            <Dialog
                open={editingItem !== null}
                onOpenChange={(open) => {
                    if (!open) setEditingItem(null)
                }}
            >
                <DialogContent className="max-w-lg bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <DialogHeader>
                        <DialogTitle className="text-[#111111] dark:text-white">Editar Documento</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <EbookForm
                            item={editingItem}
                            isPending={updateMutation.isPending}
                            onSubmit={handleUpdate}
                            onCancel={() => setEditingItem(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* AlertDialog: Confirmar Desativação */}
            <AlertDialog
                open={confirmDeactivateId !== null}
                onOpenChange={(open) => !open && setConfirmDeactivateId(null)}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Desativar Documento</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Tem certeza que deseja desativar{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {confirmDeactivateItem?.title ?? 'este documento'}
                            </span>
                            ? Ele deixará de aparecer na Biblioteca.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => confirmDeactivateId !== null && handleDeactivate(confirmDeactivateId)}
                            disabled={deactivateMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deactivateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Desativar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* AlertDialog: Confirmar Exclusão Permanente */}
            <AlertDialog
                open={confirmDeleteId !== null}
                onOpenChange={(open) => !open && setConfirmDeleteId(null)}
            >
                <AlertDialogContent className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[#111111] dark:text-white">Excluir Documento Permanentemente</AlertDialogTitle>
                        <AlertDialogDescription className="text-[#666666] dark:text-zinc-400">
                            Esta ação é <span className="font-semibold text-red-600">irreversível</span>. O documento{' '}
                            <span className="font-medium text-[#111111] dark:text-zinc-200">
                                {confirmDeleteItem?.title ?? ''}
                            </span>{' '}
                            será excluído permanentemente do sistema.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => confirmDeleteId !== null && handleHardDelete(confirmDeleteId)}
                            disabled={hardDeleteMutation.isPending}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {hardDeleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Excluir Permanentemente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
