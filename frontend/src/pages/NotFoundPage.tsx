import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
    const navigate = useNavigate();

    return (
        <div
            className="flex flex-col items-center justify-center min-h-screen p-4 text-center"
            style={{ backgroundColor: '#1A1A1A' }}
        >
            {/* Logo */}
            <img
                src="/brand/logo-white.png"
                alt="AEMS AEMS"
                className="h-12 w-auto mb-10 object-contain"
            />

            {/* 404 */}
            <h1
                className="text-8xl font-bold leading-none mb-4"
                style={{
                    color: '#F5A800',
                    fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                }}
            >
                404
            </h1>

            {/* Amber divider */}
            <div className="w-16 h-0.5 bg-[#F5A800] mb-6" />

            <h2
                className="text-2xl font-semibold text-white mb-3"
                style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
            >
                Página não encontrada
            </h2>
            <p className="text-zinc-400 mb-8 max-w-sm text-sm leading-relaxed">
                A página que você está procurando não existe ou foi movida.
            </p>

            <button
                onClick={() => navigate('/service-orders')}
                className="h-11 px-6 rounded-lg font-semibold text-sm hover:brightness-110 transition-all duration-150"
                style={{
                    backgroundColor: '#F5A800',
                    color: '#1A1A1A',
                    fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif',
                }}
            >
                Voltar para Ordens de Serviço
            </button>
        </div>
    );
}
