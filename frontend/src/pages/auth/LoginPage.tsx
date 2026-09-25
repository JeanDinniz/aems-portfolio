import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { LoginForm } from '@/features/auth/LoginForm';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { SilhouettePanel } from '@/features/auth/login-panels/SilhouettePanel';

export default function LoginPage() {
    const [sessionEndedMsg, setSessionEndedMsg] = useState<string | null>(null);
    const [installDismissed, setInstallDismissed] = useState(
        () => sessionStorage.getItem('pwa-install-dismissed') === 'true'
    );
    const { canInstall, isIOS, install } = useInstallPrompt();

    const showInstallBanner = !installDismissed && (canInstall || isIOS);

    const dismissInstall = () => {
        sessionStorage.setItem('pwa-install-dismissed', 'true');
        setInstallDismissed(true);
    };

    useEffect(() => {
        const msg = sessionStorage.getItem('session_ended_reason');
        if (msg) {
            sessionStorage.removeItem('session_ended_reason');
            setSessionEndedMsg(msg);
        }
    }, []);

    return (
        <div className="h-screen flex overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
            {/* Left side — branding panel (desktop only) */}
            <div className="hidden lg:block lg:w-1/2 xl:w-3/5 relative overflow-hidden">
                <SilhouettePanel />
            </div>

            {/* Right side — form panel */}
            <div
                className="flex w-full lg:w-1/2 xl:w-2/5 items-center justify-center p-6 sm:p-10"
                style={{ backgroundColor: '#1A1A1A' }}
            >
                <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Mobile logo (only visible below lg) */}
                    <div className="flex flex-col items-center mb-8 lg:hidden">
                        <img
                            src="/brand/logo-white.png"
                            alt="AEMS"
                            className="w-48 object-contain mb-3"
                        />
                        <div className="w-16 h-0.5" style={{ backgroundColor: '#F5A800' }} />
                    </div>

                    {sessionEndedMsg && (
                        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                            {sessionEndedMsg}
                        </div>
                    )}
                    <LoginForm />

                    {/* Banner de instalação PWA — mobile only */}
                    {showInstallBanner && (
                        <div className="mt-4 lg:hidden relative flex items-center gap-3 rounded-xl border border-[#F5A800]/30 bg-[#F5A800]/10 px-4 py-3">
                            <button
                                onClick={dismissInstall}
                                className="absolute top-2 right-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                                aria-label="Fechar"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                            {canInstall ? (
                                <button
                                    onClick={install}
                                    className="flex items-center gap-3 w-full text-left"
                                >
                                    <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0" style={{ backgroundColor: 'rgba(245,168,0,0.15)' }}>
                                        <Download className="h-4 w-4" style={{ color: '#F5A800' }} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-white">Instalar App</p>
                                        <p className="text-xs text-zinc-400">Adicionar à tela inicial do celular</p>
                                    </div>
                                </button>
                            ) : (
                                <div className="flex items-center gap-3 w-full pr-4">
                                    <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0" style={{ backgroundColor: 'rgba(245,168,0,0.15)' }}>
                                        <Share className="h-4 w-4" style={{ color: '#F5A800' }} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-white">Instalar no iPhone</p>
                                        <p className="text-xs text-zinc-400">Toque em Compartilhar → Adicionar à Tela Inicial</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

        </div>
    );
}
