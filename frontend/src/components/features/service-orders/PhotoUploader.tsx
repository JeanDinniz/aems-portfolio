import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, ImagePlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Photo } from '@/types/photo.types';
import { compressImage } from '@/utils/imageCompression';
import { validateImageFile } from '@/utils/fileValidation';
import { generateId } from '@/utils/generateId';
import { toast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

interface PhotoUploaderProps {
    photos: Photo[];
    onPhotosChange: (photos: Photo[]) => void;
    minPhotos?: number;
    maxPhotos?: number;
}

export function PhotoUploader({
    photos,
    onPhotosChange,
    minPhotos = 4,
    maxPhotos = 10,
}: PhotoUploaderProps) {
    const [isDragging, setIsDragging] = useState(false);

    const onDrop = useCallback(
        async (acceptedFiles: File[]) => {
            if (photos.length + acceptedFiles.length > maxPhotos) {
                toast({
                    variant: 'destructive',
                    title: 'Limite de fotos atingido',
                    description: `Máximo de ${maxPhotos} fotos permitidas.`,
                });
                return;
            }

            const newPhotos: Photo[] = [];

            for (const file of acceptedFiles) {
                const validation = validateImageFile(file);
                if (!validation.valid) {
                    toast({
                        variant: 'destructive',
                        title: 'Arquivo inválido',
                        description: validation.error,
                    });
                    continue;
                }

                try {
                    const compressed = await compressImage(file, {
                        maxWidth: 1920,
                        maxHeight: 1080,
                        quality: 0.8,
                    });
                    const preview = URL.createObjectURL(compressed);

                    newPhotos.push({
                        id: generateId(),
                        preview,
                        compressed,
                        uploaded: false,
                        uploadProgress: 0,
                    });
                } catch (error) {
                    logger.error('Erro ao comprimir imagem:', error);
                    toast({
                        variant: 'destructive',
                        title: 'Erro ao processar imagem',
                        description: 'Não foi possível processar a imagem. Tente novamente.',
                    });
                }
            }

            onPhotosChange([...photos, ...newPhotos]);
        },
        [photos, maxPhotos, onPhotosChange]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
        },
        maxFiles: maxPhotos - photos.length,
        disabled: photos.length >= maxPhotos,
    });

    const removePhoto = (id: string) => {
        const photo = photos.find((p) => p.id === id);
        if (photo) {
            URL.revokeObjectURL(photo.preview);
        }
        onPhotosChange(photos.filter((p) => p.id !== id));
    };

    useEffect(() => {
        return () => {
            photos.forEach(p => URL.revokeObjectURL(p.preview));
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const remainingPhotos = (minPhotos || 0) - photos.length;
    const canAddMore = photos.length < maxPhotos;

    return (
        <div className="space-y-4">
            {/* Upload Area */}
            {canAddMore && (
                <div
                    {...getRootProps()}
                    className={cn(
                        'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                        isDragActive || isDragging
                            ? 'border-primary bg-primary-50'
                            : 'border-gray-300 hover:border-primary hover:bg-gray-50'
                    )}
                    onDragEnter={() => setIsDragging(true)}
                    onDragLeave={() => setIsDragging(false)}
                >
                    <input {...getInputProps()} />
                    <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-lg font-medium mb-2">
                        Arraste fotos ou clique para selecionar
                    </p>
                    <p className="text-sm text-gray-500">
                        Formatos: JPG, PNG, WebP • Máximo: 25MB por foto
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                        {photos.length} de {maxPhotos} fotos
                        {remainingPhotos > 0 && (
                            <span className="text-orange-600 font-medium">
                                {' '}
                                • Faltam {remainingPhotos} fotos obrigatórias
                            </span>
                        )}
                    </p>
                </div>
            )}

            {/* Photo Grid */}
            {photos.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {photos.map((photo, index) => (
                        <Card key={photo.id} className="relative group overflow-hidden">
                            <CardContent className="p-0">
                                <div className="aspect-square relative">
                                    <img
                                        src={photo.preview}
                                        alt={`Foto ${index + 1}`}
                                        className="w-full h-full object-cover"
                                    />

                                    {/* Upload Progress */}
                                    {!photo.uploaded && photo.uploadProgress > 0 && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <div className="text-center text-white">
                                                <Progress value={photo.uploadProgress} className="mb-2 w-20 h-2" />
                                                <p className="text-sm">{photo.uploadProgress}%</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Remove Button */}
                                    <button
                                        type="button"
                                        onClick={() => removePhoto(photo.id)}
                                        aria-label={`Remover foto ${index + 1}`}
                                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>

                                    {/* Photo Number */}
                                    <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                                        Foto {index + 1}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}

                    {/* Add More Button (Mini) */}
                    {canAddMore && (
                        <button
                            type="button"
                            {...getRootProps()}
                            aria-label="Adicionar mais fotos"
                            className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-primary hover:bg-gray-50 transition-colors"
                        >
                            <ImagePlus className="h-8 w-8 text-gray-400 mb-2" />
                            <span className="text-sm text-gray-500">Adicionar</span>
                        </button>
                    )}
                </div>
            )}

            {/* Validation Message */}
            {remainingPhotos > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4" role="alert">
                    <p className="text-sm text-orange-800">
                        Adicione mais <strong>{remainingPhotos} foto(s)</strong> para
                        continuar. Minimo obrigatório: {minPhotos} fotos.
                    </p>
                </div>
            )}
        </div>
    );
}
