import type { LibraryCategory } from '@/types/ebook.types'

/**
 * Rótulos das categorias da Biblioteca (HML-237). Espelha
 * `frontend/src/constants/ebook.ts`.
 */
export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
    operacional: 'Operacional',
    apresentacoes: 'Apresentações',
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = ['operacional', 'apresentacoes']
