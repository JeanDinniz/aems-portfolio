import { useCallback, useRef, useState } from 'react';
import { X, ImagePlus, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { uploadService } from '@/services/api/upload.service';
import { generateId } from '@/utils/generateId';
import { toThumbUrl } from '@/utils/imageThumb';

interface PhotoCaptureProps {
    /** URLs das fotos existentes (já enviadas ao servidor) */
    photos: string[];
    /** Callback disparado ao adicionar ou remover fotos */
    onChange: (photos: string[]) => void;
    /** Quantidade máxima de fotos. Padrão: 10 */
    maxPhotos?: number;
    /** Quantidade mínima obrigatória. Padrão: 4 */
    minPhotos?: number;
}

/**
 * PhotoCapture — Componente de captura/upload de fotos para Ordens de Serviço.
 *
 * Diferente de PhotoUploader (que trabalha com objetos Photo internos),
 * este componente emite string[] de URLs prontas para persistência.
 */
export function PhotoCapture({
    photos,
    onChange,
    maxPhotos = 10,
    minPhotos = 4,
}: PhotoCaptureProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const remaining = Math.max(0, minPhotos - photos.length);
    const canAdd = photos.length < maxPhotos && uploadingCount === 0;

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length === 0) return;

            // Reset input so the same file can be re-selected if needed
            event.target.value = '';

            const availableSlots = maxPhotos - photos.length;
            const filesToUpload = files.slice(0, availableSlots);

            setUploadError(null);
            setUploadingCount(filesToUpload.length);

            try {
                const uploadedUrls: string[] = [];

                for (const file of filesToUpload) {
                    // Build a Photo-compatible object for the existing uploadService
                    const photoObj = {
                        id: generateId(),
                        file,
                        preview: URL.createObjectURL(file),
                        uploaded: false,
                        uploadProgress: 0,
                    };

                    const url = await uploadService.uploadPhoto(photoObj);
                    URL.revokeObjectURL(photoObj.preview);
                    uploadedUrls.push(url);
                    setUploadingCount((prev) => Math.max(0, prev - 1));
                }

                onChange([...photos, ...uploadedUrls]);
            } catch {
                setUploadError('Falha ao enviar uma ou mais fotos. Tente novamente.');
                setUploadingCount(0);
            }
        },
        [photos, maxPhotos, onChange]
    );

    const handleRemove = useCallback(
        (url: string) => {
            onChange(photos.filter((p) => p !== url));
        },
        [photos, onChange]
    );

    return (
        <div className="space-y-4">
            {/* Upload trigger */}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
                aria-label="Selecionar fotos"
            />

            {/* Photo grid */}
            {photos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {photos.map((url, index) => (
                        <div
                            key={url}
                            className="relative group aspect-square rounded-lg overflow-hidden border border-border"
                        >
                            <img
                                src={toThumbUrl(url)}
                                alt={`Foto ${index + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = url; }}
                            />
                            {/* Overlay label */}
                            <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                Foto {index + 1}
                            </div>
                            {/* Remove button */}
                            <button
                                type="button"
                                onClick={() => handleRemove(url)}
                                className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
                                aria-label={`Remover foto ${index + 1}`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    ))}

                    {/* Add-more mini tile */}
                    {canAdd && (
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className={cn(
                                'aspect-square border-2 border-dashed border-muted-foreground/40 rounded-lg',
                                'flex flex-col items-center justify-center gap-1',
                                'hover:border-primary hover:bg-muted/50 transition-colors'
                            )}
                            aria-label="Adicionar mais fotos"
                        >
                            <ImagePlus className="h-6 w-6 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Adicionar</span>
                        </button>
                    )}
                </div>
            )}

            {/* Empty state / drop area */}
            {photos.length === 0 && (
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={!canAdd}
                    className={cn(
                        'w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                        canAdd
                            ? 'border-muted-foreground/40 hover:border-primary hover:bg-muted/50 cursor-pointer'
                            : 'border-muted-foreground/20 cursor-not-allowed opacity-60'
                    )}
                    aria-label="Clique para adicionar fotos"
                >
                    <ImagePlus className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium">Clique para adicionar fotos</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Formatos aceitos: JPG, PNG, WebP
                    </p>
                </button>
            )}

            {/* Uploading indicator */}
            {uploadingCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                        Enviando {uploadingCount} foto{uploadingCount > 1 ? 's' : ''}...
                    </span>
                </div>
            )}

            {/* Upload error */}
            {uploadError && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <p className="text-sm text-destructive">{uploadError}</p>
                </div>
            )}

            {/* Counter / minimum requirement notice */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    {photos.length} / {maxPhotos} foto{photos.length !== 1 ? 's' : ''}
                </span>

                {remaining > 0 && (
                    <span className="text-orange-600 font-medium">
                        Faltam {remaining} foto{remaining > 1 ? 's' : ''} obrigatória
                        {remaining > 1 ? 's' : ''} (mínimo: {minPhotos})
                    </span>
                )}
            </div>

            {/* Add photo button (always visible when slots remain and photos exist) */}
            {photos.length > 0 && canAdd && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                    disabled={!canAdd}
                >
                    <ImagePlus className="h-4 w-4 mr-2" />
                    Adicionar Foto
                </Button>
            )}
        </div>
    );
}
