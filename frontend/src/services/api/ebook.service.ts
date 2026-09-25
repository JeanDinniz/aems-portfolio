import apiClient from './client'
import type {
    LibraryDocument,
    LibraryDocumentListResponse,
    LibraryDocumentCreatePayload,
    LibraryDocumentUpdatePayload,
    LibraryDocumentFilters,
    Certificate,
    CertificateCreatePayload,
    CertificateUpdatePayload,
    CertificateListResponse,
    CertificateFilters,
} from '@/types/ebook.types'

function parseFilename(disposition: string, fallback = 'certificado.pdf'): string {
    const match = disposition.match(/filename="?([^";\s]+)"?/)
    return match?.[1] ?? fallback
}

const ebookService = {
    // ── Biblioteca de Documentos ──────────────────────────────────────────────
    list: async (params?: LibraryDocumentFilters): Promise<LibraryDocumentListResponse> =>
        apiClient.get('/ebook', { params }).then((r) => r.data),

    getById: async (id: number): Promise<LibraryDocument> =>
        apiClient.get(`/ebook/${id}`).then((r) => r.data),

    create: async (payload: LibraryDocumentCreatePayload): Promise<LibraryDocument> =>
        apiClient.post('/ebook', payload).then((r) => r.data),

    update: async (id: number, payload: LibraryDocumentUpdatePayload): Promise<LibraryDocument> =>
        apiClient.patch(`/ebook/${id}`, payload).then((r) => r.data),

    deactivate: async (id: number): Promise<LibraryDocument> =>
        apiClient.delete(`/ebook/${id}`).then((r) => r.data),

    hardDelete: async (id: number): Promise<{ id: number; title: string }> =>
        apiClient.delete(`/ebook/${id}/permanent`).then((r) => r.data),

    // ── Certificados de Garantia ──────────────────────────────────────────────
    createCertificate: async (payload: CertificateCreatePayload): Promise<Certificate> =>
        apiClient.post('/ebook/certificates', payload).then((r) => r.data),

    getCertificateById: async (id: number): Promise<Certificate> =>
        apiClient.get(`/ebook/certificates/${id}`).then((r) => r.data),

    updateCertificate: async (id: number, payload: CertificateUpdatePayload): Promise<Certificate> =>
        apiClient.patch(`/ebook/certificates/${id}`, payload).then((r) => r.data),

    listCertificates: async (params?: CertificateFilters): Promise<CertificateListResponse> =>
        apiClient.get('/ebook/certificates', { params }).then((r) => r.data),

    getCertificatePdf: async (id: number): Promise<{ blob: Blob; filename: string }> => {
        const response = await apiClient.get(`/ebook/certificates/${id}/pdf`, {
            responseType: 'blob',
        })
        return {
            blob: response.data as Blob,
            filename: parseFilename(response.headers['content-disposition'] ?? ''),
        }
    },

    deleteCertificate: async (id: number): Promise<void> => {
        await apiClient.delete(`/ebook/certificates/${id}`)
    },
}

export default ebookService
