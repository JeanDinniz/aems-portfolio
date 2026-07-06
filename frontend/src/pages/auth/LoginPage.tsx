import { useEffect, useState } from 'react';
import { Sparkles, Shield, Zap, Download, Share, X } from 'lucide-react';
import { LoginForm } from '@/features/auth/LoginForm';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';

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
            <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 relative flex-col items-center justify-center p-12 overflow-hidden">
                {/* Background gradient layers */}
                <div
                    className="absolute inset-0"
                    style={{
                        background: 'linear-gradient(135deg, #1A1A1A 0%, #111111 100%)',
                    }}
                />
                <div
                    className="absolute inset-0 opacity-10"
                    style={{
                        backgroundImage:
                            'radial-gradient(circle at 30% 20%, #F5A800 0%, transparent 50%), radial-gradient(circle at 70% 80%, #F5A800 0%, transparent 40%)',
                    }}
                />

                {/* Decorative grid */}
                <div
                    className="absolute inset-0 opacity-5"
                    style={{
                        backgroundImage:
                            'linear-gradient(#F5A800 1px, transparent 1px), linear-gradient(90deg, #F5A800 1px, transparent 1px)',
                        backgroundSize: '60px 60px',
                    }}
                />

                {/* Decorative glowing circle */}
                <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-5 blur-3xl"
                    style={{ backgroundColor: '#F5A800' }}
                />

                {/* Content */}
                <div className="relative z-10 flex flex-col items-center text-center max-w-md">
                    {/* Brand logo */}
                    <img
                        src="/brand/logo-white.png"
                        alt="AEMS"
                        className="w-64 xl:w-72 object-contain drop-shadow-2xl mb-10"
                    />

                    {/* Amber divider line — brand graphic element */}
                    <div className="w-24 h-0.5 mb-8" style={{ backgroundColor: '#F5A800' }} />

                    {/* Feature highlights */}
                    <div className="grid grid-cols-1 gap-4 w-full max-w-xs">
                        {[
                            { icon: Shield, label: 'Seguro e confiável' },
                            { icon: Zap, label: 'Rápido e eficiente' },
                            { icon: Sparkles, label: 'Interface moderna' },
                        ].map(({ icon: Icon, label }) => (
                            <div
                                key={label}
                                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm"
                            >
                                <div
                                    className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                                    style={{ backgroundColor: 'rgba(252, 175, 22, 0.15)' }}
                                >
                                    <Icon className="w-4 h-4" style={{ color: '#F5A800' }} />
                                </div>
                                <span
                                    className="text-zinc-300 text-sm font-medium"
                                    style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                                >
                                    {label}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bottom attribution */}
                <p className="absolute bottom-8 text-zinc-600 text-xs z-10">
                    &copy; {new Date().getFullYear()} AEMS. Todos os direitos reservados.
                </p>
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
