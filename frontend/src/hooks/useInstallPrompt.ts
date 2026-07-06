import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useInstallPrompt() {
    const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [isInstalled, setIsInstalled] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
    );

    const isIOS =
        typeof navigator !== 'undefined' &&
        /iphone|ipad|ipod/i.test(navigator.userAgent) &&
        !(window as unknown as { MSStream?: unknown }).MSStream;

    useEffect(() => {
        const handlePrompt = (e: Event) => {
            e.preventDefault();
            setPromptEvent(e as BeforeInstallPromptEvent);
        };
        const handleInstalled = () => {
            setIsInstalled(true);
            setPromptEvent(null);
        };

        window.addEventListener('beforeinstallprompt', handlePrompt);
        window.addEventListener('appinstalled', handleInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handlePrompt);
            window.removeEventListener('appinstalled', handleInstalled);
        };
    }, []);

    const install = async () => {
        if (!promptEvent) return;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
            setIsInstalled(true);
            setPromptEvent(null);
        }
    };

    return {
        canInstall: !!promptEvent && !isInstalled,
        isInstalled,
        isIOS,
        install,
    };
}
