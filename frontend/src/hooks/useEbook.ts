import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ebookService from '@/services/api/ebook.service'
import type {
    LibraryDocumentFilters,
    LibraryDocumentCreatePayload,
    LibraryDocumentUpdatePayload,
    CertificateCreatePayload,
    CertificateUpdatePayload,
    CertificateFilters,
} from '@/types/ebook.types'
import { useToast } from '@/hooks/use-toast'

// ── Biblioteca de Documentos ──────────────────────────────────────────────────

export function useLibraryDocuments(filters?: LibraryDocumentFilters) {
    return useQuery({
        queryKey: ['ebook', filters],
        queryFn: () => ebookService.list(filters),
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    })
}

export function useLibraryDocument(id: number | null) {
    return useQuery({
        queryKey: ['ebook', id],
        queryFn: () => ebookService.getById(id!),
        enabled: id !== null,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    })
}

export function useCreateDocument() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (payload: LibraryDocumentCreatePayload) => ebookService.create(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ebook'] })
        },
    })
}

export function useUpdateDocument() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: LibraryDocumentUpdatePayload }) =>
            ebookService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ebook'] })
        },
    })
}

export function useDeactivateDocument() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: number) => ebookService.deactivate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ebook'] })
        },
    })
}

export function useHardDeleteDocument() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: number) => ebookService.hardDelete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ebook'] })
        },
    })
}

// ── Certificados de Garantia ──────────────────────────────────────────────────

export function useCreateCertificate() {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    return useMutation({
        mutationFn: (payload: CertificateCreatePayload) => ebookService.createCertificate(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates'] })
        },
        onError: () => {
            toast({
                variant: 'destructive',
                title: 'Erro ao gerar certificado',
                description: 'Não foi possível gerar o certificado. Tente novamente.',
            })
        },
    })
}

export function useCertificates(filters?: CertificateFilters) {
    return useQuery({
        queryKey: ['certificates', filters],
        queryFn: () => ebookService.listCertificates(filters),
        staleTime: 1000 * 60,
    })
}

export function useCertificate(id: number | null) {
    return useQuery({
        queryKey: ['certificate', id],
        queryFn: () => ebookService.getCertificateById(id!),
        enabled: id !== null,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    })
}

export function useUpdateCertificate() {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: CertificateUpdatePayload }) =>
            ebookService.updateCertificate(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates'] })
            queryClient.invalidateQueries({ queryKey: ['certificate'] })
        },
        onError: () => {
            toast({
                variant: 'destructive',
                title: 'Erro ao atualizar certificado',
                description: 'Não foi possível atualizar o certificado. Tente novamente.',
            })
        },
    })
}

export function useDeleteCertificate() {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    return useMutation({
        mutationFn: (id: number) => ebookService.deleteCertificate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates'] })
            toast({ title: 'Certificado excluído' })
        },
        onError: () => {
            toast({
                variant: 'destructive',
                title: 'Erro ao excluir',
                description: 'Não foi possível excluir o certificado.',
            })
        },
    })
}
