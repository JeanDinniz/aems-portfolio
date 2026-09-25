import { useCallback, useRef, useState } from 'react';
import { Video, X, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { uploadService } from '@/services/api/upload.service';

interface VideoCaptureProps {
    /** URL do vídeo já enviado (ou null) */
    videoUrl: string | null;
    /** Emite a nova URL ao enviar, ou null ao remover */
    onChange: (url: string | null) => void;
    /** Teto em MB. Padrão: 50 */
    maxSizeMB?: number;
}

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime'];

/**
 * VideoCapture — anexo de UM vídeo curto da vistoria (opcional).
 * Valida tipo (MP4/MOV) e tamanho antes de subir; upload imediato; player + remover.
 */
export function VideoCapture({ videoUrl, onChange, maxSizeMB = 50 }: VideoCaptureProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;

            setError(null);

            if (!ACCEPTED_TYPES.includes(file.type)) {
                setError('Formato não suportado. Envie um vídeo MP4 ou MOV.');
                return;
            }
            if (file.size > maxSizeMB * 1024 * 1024) {
                setError(`Vídeo muito grande. Máximo: ${maxSizeMB} MB. Grave um clipe mais curto.`);
                return;
            }

            setUploading(true);
            try {
                const url = await uploadService.uploadVideo(file);
                onChange(url);
            } catch {
                setError('Falha ao enviar o vídeo. Tente novamente.');
            } finally {
                setUploading(false);
            }
        },
        [maxSizeMB, onChange]
    );

    const handleRemove = useCallback(() => {
        onChange(null);
        setError(null);
    }, [onChange]);

    return (
        <div className="space-y-2">
            <input
                ref={inputRef}
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={handleFileChange}
                aria-label="Selecionar vídeo"
            />

            {videoUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-border">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video src={videoUrl} controls className="w-full max-h-64 bg-black" />
                    <button
                        type="button"
                        onClick={handleRemove}
                        className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
                        aria-label="Remover vídeo"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ) : !error ? (
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    className={cn(
                        'w-full border-2 border-dashed rounded-lg p-6 text-center transition-colors',
                        uploading
                            ? 'border-muted-foreground/20 cursor-wait opacity-70'
                            : 'border-muted-foreground/40 hover:border-primary hover:bg-muted/50 cursor-pointer'
                    )}
                    aria-label="Anexar vídeo"
                >
                    {uploading ? (
                        <span className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Enviando vídeo...
                        </span>
                    ) : (
                        <span className="flex flex-col items-center gap-1 text-muted-foreground">
                            <Video className="h-8 w-8" />
                            <span className="text-sm font-medium">Anexar vídeo (opcional)</span>
                            <span className="text-xs">MP4 ou MOV • máx {maxSizeMB} MB</span>
                        </span>
                    )}
                </button>
            ) : null}

            {error && (
                <div className="space-y-2">
                    <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-2">
                        <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                        <p className="text-sm text-destructive">{error}</p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setError(null); inputRef.current?.click(); }}
                    >
                        Tentar novamente
                    </Button>
                </div>
            )}
        </div>
    );
}
