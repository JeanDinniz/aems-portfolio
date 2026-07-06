export interface Photo {
    id: string;
    file?: File; // Arquivo original — opcional; liberado após compressão
    preview: string; // URL de preview (blob do comprimido)
    compressed?: Blob; // Versão comprimida
    uploaded: boolean; // Se já foi enviado ao backend
    uploadProgress: number; // 0-100
    url?: string; // URL no servidor (após upload)
    error?: string; // Erro de upload
}
