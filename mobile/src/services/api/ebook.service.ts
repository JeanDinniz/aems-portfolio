import { apiClient } from './client'
import type {
    LibraryDocument,
    LibraryDocumentListResponse,
    LibraryDocumentFilters,
    Certificate,
    CertificateCreatePayload,
    CertificateUpdatePayload,
    CertificateListResponse,
    CertificateFilters,
} from '@/types/ebook.types'

/**
 * Biblioteca de Documentos + Certificados — portado de
 * `frontend/src/services/api/ebook.service.ts`, SEM o CRUD admin de documentos
 * (create/update/delete de arquivo fica só no web). O mobile é consumo:
 * lista/abre/baixa documentos e gerencia certificados (gerar/editar/excluir).
 *
 * O backend `/ebook` já existe (não alterado). Os arquivos da biblioteca são
 * abertos/baixados diretamente pela URL (`file_url`) — não passam por blob aqui.
 * O PDF do certificado é baixado pela tela via `downloadAndSharePdf`
 * (`@/utils/exportShare`).
 */
export const ebookService = {
    // ── Biblioteca de Documentos ──────────────────────────────────
    list: async (params?: LibraryDocumentFilters): Promise<LibraryDocumentListResponse> =>
        apiClient.get('/ebook', { params }).then((r) => r.data),

    getById: async (id: number): Promise<LibraryDocument> =>
        apiClient.get(`/ebook/${id}`).then((r) => r.data),

    // ── Certificados de Garantia ──────────────────────────────────
    listCertificates: async (params?: CertificateFilters): Promise<CertificateListResponse> =>
        apiClient.get('/ebook/certificates', { params }).then((r) => r.data),

    getCertificateById: async (id: number): Promise<Certificate> =>
        apiClient.get(`/ebook/certificates/${id}`).then((r) => r.data),

    createCertificate: async (payload: CertificateCreatePayload): Promise<Certificate> =>
        apiClient.post('/ebook/certificates', payload).then((r) => r.data),

    updateCertificate: async (
        id: number,
        payload: CertificateUpdatePayload
    ): Promise<Certificate> =>
        apiClient.patch(`/ebook/certificates/${id}`, payload).then((r) => r.data),

    deleteCertificate: async (id: number): Promise<void> =>
        apiClient.delete(`/ebook/certificates/${id}`).then(() => undefined),
}

export default ebookService
