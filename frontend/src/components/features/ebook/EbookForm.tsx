import { useState, useRef } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Upload, FileText, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { logger } from '@/lib/logger'
import type { LibraryDocument, LibraryDocumentCreatePayload, LibraryDocumentUpdatePayload } from '@/types/ebook.types'
import { LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS } from '@/constants/ebook'
import { uploadService } from '@/services/api/upload.service'

// --------------------------------------------------------------------------
// Schema
// --------------------------------------------------------------------------

const ACCEPTED_TYPES = [
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

const documentFormSchema = z.object({
    category: z.enum(['operacional', 'apresentacoes'], {
        error: 'Categoria obrigatória',
    }),
    title: z.string().min(1, 'Título obrigatório'),
    description: z.string().optional().or(z.literal('')),
})

type DocumentFormValues = z.infer<typeof documentFormSchema>

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

interface EbookFormProps {
    item?: LibraryDocument
    isPending?: boolean
    onSubmit: (payload: LibraryDocumentCreatePayload | LibraryDocumentUpdatePayload) => void
    onCancel: () => void
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function formatFileSize(bytes: number | null): string {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileExtensionLabel(fileName: string): string {
    const ext = fileName.split('.').pop()?.toUpperCase()
    return ext ?? 'DOC'
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export function EbookForm({ item, isPending, onSubmit, onCancel }: EbookFormProps) {
    const isEdit = !!item
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Current file state: either existing (from item) or newly selected
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState<string | null>(null)

    // For existing item in edit mode, track whether we're replacing the file
    const existingFile = isEdit
        ? { name: item.file_name, size: item.file_size, url: item.file_url }
        : null

    const {
        register,
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<DocumentFormValues>({
        resolver: zodResolver(documentFormSchema),
        defaultValues: item
            ? {
                  category: item.category,
                  title: item.title,
                  description: item.description ?? '',
              }
            : {
                  description: '',
              },
    })

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!ACCEPTED_TYPES.includes(file.type)) {
            toast({
                variant: 'destructive',
                title: 'Tipo de arquivo inválido',
                description: 'Envie um PDF, PowerPoint, Word ou Excel.',
            })
            return
        }

        if (file.size > MAX_FILE_SIZE) {
            toast({
                variant: 'destructive',
                title: 'Arquivo muito grande',
                description: 'O arquivo deve ter no máximo 50 MB.',
            })
            return
        }

        setSelectedFile(file)
        // Reset input so same file can be re-selected if user clears
        e.target.value = ''
    }

    const handleFormSubmit = async (values: DocumentFormValues) => {
        // Create mode requires a file; edit mode can keep existing file
        if (!isEdit && !selectedFile) {
            toast({ variant: 'destructive', title: 'Selecione um arquivo para enviar.' })
            return
        }

        try {
            let fileUrl = item?.file_url ?? ''
            let fileName = item?.file_name ?? ''
            let fileType = item?.file_type ?? null
            let fileSize = item?.file_size ?? null

            if (selectedFile) {
                setUploading(true)
                setUploadProgress('Enviando arquivo...')
                const result = await uploadService.uploadDocument(selectedFile)
                fileUrl = result.url
                fileName = result.file_name
                fileType = result.file_type
                fileSize = result.file_size
            }

            const payload: LibraryDocumentCreatePayload | LibraryDocumentUpdatePayload = {
                category: values.category,
                title: values.title,
                description: values.description || null,
                file_url: fileUrl,
                file_name: fileName,
                file_type: fileType,
                file_size: fileSize,
            }

            onSubmit(payload)
        } catch (err) {
            logger.error('Erro ao enviar documento:', err)
            toast({ variant: 'destructive', title: 'Erro ao enviar arquivo. Tente novamente.' })
        } finally {
            setUploading(false)
            setUploadProgress(null)
        }
    }

    const inputCls = 'bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]'
    const labelCls = 'text-[#666666] dark:text-zinc-300 text-sm font-medium'

    // Display file info (selected takes precedence over existing)
    const displayFile = selectedFile
        ? { name: selectedFile.name, size: selectedFile.size }
        : existingFile ?? null

    const isSubmitting = isPending || uploading

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">

            {/* Categoria */}
            <div className="space-y-1.5">
                <Label className={labelCls}>Categoria <span className="text-red-500">*</span></Label>
                <Controller
                    name="category"
                    control={control}
                    render={({ field }) => (
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                            <SelectTrigger className={inputCls}>
                                <SelectValue placeholder="Selecione a categoria" />
                            </SelectTrigger>
                            <SelectContent>
                                {LIBRARY_CATEGORIES.map((cat) => (
                                    <SelectItem key={cat} value={cat}>
                                        {LIBRARY_CATEGORY_LABELS[cat]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                />
                {errors.category && <p className="text-xs text-red-500">{errors.category.message}</p>}
            </div>

            {/* Título */}
            <div className="space-y-1.5">
                <Label className={labelCls}>Título <span className="text-red-500">*</span></Label>
                <Input
                    {...register('title')}
                    placeholder="Ex: Manual de Procedimentos Operacionais"
                    className={inputCls}
                />
                {errors.title && <p className="text-xs text-red-500">{errors.title.message}</p>}
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
                <Label className={labelCls}>Descrição</Label>
                <Textarea
                    {...register('description')}
                    placeholder="Breve descrição do conteúdo do arquivo..."
                    rows={3}
                    className={cn(inputCls, 'resize-none')}
                />
            </div>

            {/* Upload de arquivo */}
            <div className="space-y-1.5">
                <Label className={labelCls}>
                    Arquivo {!isEdit && <span className="text-red-500">*</span>}
                    {isEdit && <span className="text-xs text-[#999999] dark:text-zinc-500 font-normal ml-1">(deixe em branco para manter o atual)</span>}
                </Label>

                {/* Área de upload / arquivo selecionado */}
                {displayFile ? (
                    <div className="flex items-center gap-3 rounded-lg border border-[#D1D1D1] dark:border-[#333333] bg-gray-50 dark:bg-zinc-800/40 px-4 py-3">
                        <div
                            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold text-white"
                            style={{ backgroundColor: '#F5A800', color: '#111111' }}
                        >
                            {getFileExtensionLabel(displayFile.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#111111] dark:text-white truncate">
                                {displayFile.name}
                            </p>
                            {displayFile.size && (
                                <p className="text-xs text-[#999999] dark:text-zinc-500 mt-0.5">
                                    {formatFileSize(displayFile.size)}
                                </p>
                            )}
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                                setSelectedFile(null)
                                if (fileInputRef.current) fileInputRef.current.value = ''
                            }}
                            aria-label="Remover arquivo"
                            className="shrink-0 h-8 w-8 text-[#999999] hover:text-red-500"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                            'w-full rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                            'border-[#D1D1D1] dark:border-[#333333] hover:border-[#F5A800] hover:bg-[#F5A800]/5',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A800]'
                        )}
                    >
                        <FileText className="h-8 w-8 mx-auto mb-2 text-[#999999] dark:text-zinc-500" />
                        <p className="text-sm font-medium text-[#666666] dark:text-zinc-300">
                            Clique para selecionar o arquivo
                        </p>
                        <p className="text-xs text-[#999999] dark:text-zinc-500 mt-1">
                            PDF, PowerPoint, Word, Excel — máx. 50 MB
                        </p>
                    </button>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx"
                    onChange={handleFileSelect}
                    className="hidden"
                    aria-hidden="true"
                />

                {selectedFile && isEdit && (
                    <p className="text-xs text-[#F5A800] flex items-center gap-1">
                        <Upload className="h-3 w-3" />
                        Novo arquivo selecionado — substituirá o atual ao salvar
                    </p>
                )}
            </div>

            {/* Progresso de upload */}
            {uploading && uploadProgress && (
                <div className="flex items-center gap-2 text-sm text-[#666666] dark:text-zinc-400 bg-gray-50 dark:bg-zinc-800/40 rounded-lg px-4 py-3 border border-[#E8E8E8] dark:border-[#333333]">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 text-[#F5A800]" />
                    {uploadProgress}
                </div>
            )}

            {/* Ações */}
            <div className="flex justify-end gap-3 pt-2">
                <Button
                    type="button"
                    onClick={onCancel}
                    disabled={isSubmitting}
                    className="border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 hover:border-[#F5A800] hover:text-[#F5A800] bg-transparent"
                >
                    Cancelar
                </Button>
                <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="font-semibold"
                    style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                >
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {uploading ? 'Enviando...' : isEdit ? 'Salvar Alterações' : 'Adicionar Documento'}
                </Button>
            </div>
        </form>
    )
}
