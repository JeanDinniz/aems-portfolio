import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CHUNK_RELOAD_KEY = 'route-error-chunk-reload-at';

/** Erro de carregamento de chunk lazy — típico logo após um deploy, quando o
 *  hash dos arquivos JS muda e o navegador ainda referencia o antigo. */
function isChunkLoadError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
        error.name === 'ChunkLoadError' ||
        /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
            error.message
        )
    );
}

/**
 * errorElement das rotas raiz: qualquer exceção de render que escapar cai aqui
 * em vez da tela padrão em inglês do React Router ("Unexpected Application
 * Error!"), sem recuperação e sem identidade visual.
 *
 * Para ChunkLoadError, recarrega automaticamente UMA vez (guard de 30s no
 * sessionStorage evita loop) — o reload busca o index.html novo e resolve.
 */
export function RouteErrorPage() {
    const error = useRouteError();
    const chunkError = isChunkLoadError(error);

    useEffect(() => {
        if (!chunkError) return;
        const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
        if (Date.now() - last > 30_000) {
            sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
            window.location.reload();
        }
    }, [chunkError]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-white dark:bg-[#1A1A1A] p-4">
            <div className="max-w-md w-full text-center space-y-4 rounded-xl border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] p-8">
                <AlertCircle className="h-10 w-10 mx-auto text-red-500" />
                <h1 className="text-lg font-semibold text-[#111111] dark:text-white">
                    {chunkError ? 'Nova versão disponível' : 'Algo deu errado'}
                </h1>
                <p className="text-sm text-[#666666] dark:text-zinc-400">
                    {chunkError
                        ? 'O sistema foi atualizado. Recarregando a página...'
                        : 'Ocorreu um erro inesperado ao exibir esta tela. Recarregue a página para continuar.'}
                </p>
                <Button
                    onClick={() => window.location.reload()}
                    style={{ backgroundColor: '#F5A800', color: '#000' }}
                    className="font-semibold"
                >
                    Recarregar página
                </Button>
            </div>
        </div>
    );
}
