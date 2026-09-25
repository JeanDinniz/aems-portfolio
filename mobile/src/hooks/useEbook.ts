import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ebookService } from '@/services/api/ebook.service'
import { serviceOrdersService } from '@/services/api/service-orders.service'
import { useToast } from '@/components/ui/Toast'
import type {
    CertificateCreatePayload,
    CertificateUpdatePayload,
    CertificateFilters,
    LibraryDocumentFilters,
} from '@/types/ebook.types'

/**
 * Biblioteca + Certificados — hooks TanStack Query v5 (portado de
 * `frontend/src/hooks/useEbook.ts`, sem os hooks de CRUD admin de documentos).
 * QueryKeys idênticas ao web (`['ebook']`, `['certificates']`, `['certificate']`).
 */

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
        queryFn: () => ebookService.getById(id as number),
        enabled: id !== null,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    })
}

// ── Certificados de Garantia ────────────────────────────────────────────────

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
        queryFn: () => ebookService.getCertificateById(id as number),
        enabled: id !== null,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    })
}

export function useCreateCertificate() {
    const queryClient = useQueryClient()
    const toast = useToast()
    return useMutation({
        mutationFn: (payload: CertificateCreatePayload) =>
            ebookService.createCertificate(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates'] })
        },
        onError: () => {
            toast.error('Não foi possível gerar o certificado. Tente novamente.')
        },
    })
}

export function useUpdateCertificate() {
    const queryClient = useQueryClient()
    const toast = useToast()
    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: CertificateUpdatePayload }) =>
            ebookService.updateCertificate(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates'] })
            queryClient.invalidateQueries({ queryKey: ['certificate'] })
        },
        onError: () => {
            toast.error('Não foi possível atualizar o certificado. Tente novamente.')
        },
    })
}

export function useDeleteCertificate() {
    const queryClient = useQueryClient()
    const toast = useToast()
    return useMutation({
        mutationFn: (id: number) => ebookService.deleteCertificate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['certificates'] })
        },
        onError: () => {
            toast.error('Não foi possível excluir o certificado.')
        },
    })
}

// ── Busca de O.S. por placa (vincular certificado) ───────────────────────────
//
// Espelha o `handleSearchOs` do web `GenerateCertificateDialog`: busca sob demanda
// (ao tocar em "Buscar") o histórico do veículo por placa/número e devolve a O.S.
// mais recente para pré-preencher placa/serviço/os_number/service_order_id.
// Usa mutation (imperativo) em vez de query — o disparo é manual, não reativo.
export function useVehicleHistorySearch() {
    return useMutation({
        mutationFn: (plate: string) => serviceOrdersService.getVehicleHistory(plate.trim()),
    })
}
