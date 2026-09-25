import apiClient from '@/services/api/client';
import type { Photo } from '@/types/photo.types';
import { logger } from '@/lib/logger';

export const uploadService = {
    async uploadDocument(file: File): Promise<{
        url: string;
        file_name: string;
        file_type: string;
        file_size: number;
    }> {
        const formData = new FormData();
        formData.append('file', file);

        const response = await apiClient.post<{
            url: string;
            file_name: string;
            file_type: string;
            file_size: number;
        }>('/upload/document', formData, {
            timeout: 120_000,
            headers: { 'Content-Type': null },
        });

        return response.data;
    },

    async uploadPhoto(photo: Photo): Promise<string> {
        const blob = photo.compressed ?? photo.file;
        if (!blob) throw new Error(`Photo ${photo.id} has no content to upload`);

        const formData = new FormData();
        const blobType = blob instanceof File ? blob.type : blob.type || 'image/jpeg';
        const ext = blobType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
        const fileToUpload =
            blob instanceof File ? blob : new File([blob], `photo.${ext}`, { type: blobType });
        formData.append('file', fileToUpload);

        // Content-Type: null remove o default 'application/json' para esta requisição.
        // O XHR só injeta 'multipart/form-data; boundary=...' automaticamente quando
        // Content-Type NÃO está nos author request headers — conforme XHR spec §4.5.6.
        const response = await apiClient.post<{ url: string }>('/upload/photo', formData, {
            timeout: 120_000, // 2 min para upload de fotos
            headers: { 'Content-Type': null },
        });

        return response.data.url;
    },

    async uploadVideo(file: File): Promise<string> {
        const formData = new FormData();
        formData.append('file', file);

        const response = await apiClient.post<{ url: string }>('/upload/video', formData, {
            timeout: 300_000, // 5 min — vídeo é maior que foto
            headers: { 'Content-Type': null },
        });

        return response.data.url;
    },

    async uploadPhotos(photos: Photo[]): Promise<Array<{ id: string; url: string }>> {
        const uploadPromises = photos.map(async (photo) => {
            if (photo.url) return { id: photo.id, url: photo.url };

            try {
                const url = await this.uploadPhoto(photo);
                photo.uploaded = true;
                photo.url = url;
                return { id: photo.id, url };
            } catch (error) {
                logger.error(`Error uploading photo ${photo.id}`, error);
                throw error;
            }
        });

        return Promise.all(uploadPromises);
    },
};
