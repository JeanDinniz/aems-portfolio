import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { Settings, User, Bell, Palette, Shield, Sun, Moon, Target } from 'lucide-react';
import { subscribeWebPush, unsubscribeWebPush } from '@/services/webPush';
import { useToast } from '@/hooks/use-toast';
import { useRevenueGoals, useUpdateRevenueGoals } from '@/hooks/useSettings';

const STORAGE_KEY_DARK = 'aems-dark-mode';

function readBoolFromStorage(key: string, defaultValue: boolean): boolean {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === 'true';
}

function applyDarkMode(enabled: boolean): void {
    document.documentElement.classList.toggle('dark', enabled);
}

export default function SettingsPage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { toast } = useToast();

    const [notifyPush, setNotifyPush] = useState<boolean>(() =>
        typeof Notification !== 'undefined' && Notification.permission === 'granted'
    );
    const [darkMode, setDarkMode] = useState<boolean>(() =>
        readBoolFromStorage(STORAGE_KEY_DARK, false)
    );

    // Metas de Faturamento (por funcionário) — só Owner
    const isOwner = user?.role === 'owner';
    const revenueGoalsQuery = useRevenueGoals(isOwner);
    const updateGoals = useUpdateRevenueGoals();
    const [goals, setGoals] = useState({ tier_1: '', tier_2: '', tier_3: '' });
    // Sincroniza os campos com o valor carregado do backend na primeira vez que
    // ele chega (padrão React de ajustar estado a partir de props durante o render,
    // sem useEffect). Depois disso o usuário edita livremente.
    const [syncedGoals, setSyncedGoals] = useState<typeof revenueGoalsQuery.data>(undefined);
    if (revenueGoalsQuery.data && revenueGoalsQuery.data !== syncedGoals) {
        setSyncedGoals(revenueGoalsQuery.data);
        setGoals({
            tier_1: String(revenueGoalsQuery.data.tier_1),
            tier_2: String(revenueGoalsQuery.data.tier_2),
            tier_3: String(revenueGoalsQuery.data.tier_3),
        });
    }

    const handleSaveGoals = async () => {
        const parsed = {
            tier_1: Number(goals.tier_1),
            tier_2: Number(goals.tier_2),
            tier_3: Number(goals.tier_3),
        };
        if (Object.values(parsed).some((v) => Number.isNaN(v) || v < 0)) {
            toast({
                variant: 'destructive',
                title: 'Valores inválidos',
                description: 'Informe valores numéricos maiores ou iguais a zero.',
            });
            return;
        }
        try {
            await updateGoals.mutateAsync(parsed);
            toast({ title: 'Metas atualizadas', description: 'As metas de faturamento foram salvas.' });
        } catch {
            toast({
                variant: 'destructive',
                title: 'Erro ao salvar metas',
                description: 'Tente novamente mais tarde.',
            });
        }
    };

    // Apply dark mode class on mount based on persisted value
    useEffect(() => {
        applyDarkMode(readBoolFromStorage(STORAGE_KEY_DARK, false));
    }, []);

    const handleNotifyPushChange = async (checked: boolean) => {
        if (checked) {
            if (typeof Notification === 'undefined') return;
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                try {
                    await subscribeWebPush();
                    setNotifyPush(true);
                } catch {
                    toast({
                        variant: 'destructive',
                        title: 'Erro ao ativar notificações',
                        description: 'Tente novamente mais tarde.',
                    });
                }
            }
        } else {
            try {
                await unsubscribeWebPush();
            } catch {
                // best-effort
            }
            setNotifyPush(false);
        }
    };

    const handleDarkModeChange = (checked: boolean) => {
        setDarkMode(checked);
        localStorage.setItem(STORAGE_KEY_DARK, String(checked));
        applyDarkMode(checked);
    };

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5 max-w-3xl">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                    <Settings className="w-5 h-5" style={{ color: '#F5A800' }} />
                </div>
                <div>
                    <h1
                        className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                        style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                    >
                        Configurações
                    </h1>
                    <p className="text-sm text-[#666666] dark:text-zinc-400">Preferências e segurança da sua conta</p>
                </div>
            </div>

            {/* Informações do Perfil */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                    <div className="w-8 h-8 rounded-lg bg-[#F5A800]/10 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4" style={{ color: '#F5A800' }} />
                    </div>
                    <span className="text-base font-semibold text-[#111111] dark:text-white">Informações do Perfil</span>
                </div>

                {/* Card content */}
                <div className="p-6 space-y-5">
                    {/* Avatar */}
                    <div className="flex items-center gap-4">
                        <div
                            className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
                            style={{
                                backgroundColor: 'rgba(245, 168, 0, 0.15)',
                                border: '2px solid rgba(245, 168, 0, 0.3)',
                                color: '#F5A800',
                            }}
                        >
                            {user?.full_name
                                ? user.full_name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()
                                : 'U'}
                        </div>
                        <div>
                            <p className="text-base font-semibold text-[#111111] dark:text-white">{user?.full_name || 'Usuário'}</p>
                            <p className="text-sm text-[#666666] dark:text-zinc-400">{user?.email || ''}</p>
                        </div>
                    </div>

                    <div className="border-t border-[#E8E8E8] dark:border-[#333333]" />

                    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                        <div>
                            <p className="text-xs text-[#999999] dark:text-zinc-500 uppercase tracking-wide mb-0.5">Nome</p>
                            <p className="text-sm font-medium text-[#111111] dark:text-zinc-200">{user?.full_name || 'Não informado'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-[#999999] dark:text-zinc-500 uppercase tracking-wide mb-0.5">Email</p>
                            <p className="text-sm font-medium text-[#111111] dark:text-zinc-200">{user?.email || 'Não informado'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-[#999999] dark:text-zinc-500 uppercase tracking-wide mb-0.5">Cargo</p>
                            <p className="text-sm font-medium text-[#111111] dark:text-zinc-200 capitalize">{user?.role || 'Não informado'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-[#999999] dark:text-zinc-500 uppercase tracking-wide mb-0.5">Loja</p>
                            <p className="text-sm font-medium text-[#111111] dark:text-zinc-200">
                                {user?.role === 'owner'
                                    ? 'Todas as lojas'
                                    : `Loja ${user?.store_id || '-'}`}
                            </p>
                        </div>
                    </div>

                    <div className="pt-1">
                        <button
                            onClick={() => navigate('/profile')}
                            className="px-4 py-2 rounded-lg text-sm font-medium border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 transition-colors hover:border-[#F5A800] hover:text-[#F5A800]"
                        >
                            Editar Perfil
                        </button>
                    </div>
                </div>
            </div>

            {/* Notificações */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                    <div className="w-8 h-8 rounded-lg bg-[#F5A800]/10 flex items-center justify-center shrink-0">
                        <Bell className="w-4 h-4" style={{ color: '#F5A800' }} />
                    </div>
                    <span className="text-base font-semibold text-[#111111] dark:text-white">Notificações</span>
                </div>

                {/* Card content */}
                <div className="p-6 space-y-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                                <Bell className="w-4 h-4 text-[#666666] dark:text-zinc-400" />
                            </div>
                            <div className="space-y-0.5">
                                <Label
                                    htmlFor="push-notifications"
                                    className="text-sm font-medium text-[#111111] dark:text-zinc-200 cursor-pointer"
                                >
                                    Notificações Push
                                </Label>
                                <p className="text-xs text-[#666666] dark:text-zinc-500">Alertas em tempo real no navegador</p>
                            </div>
                        </div>
                        <Switch
                            id="push-notifications"
                            checked={notifyPush}
                            onCheckedChange={handleNotifyPushChange}
                        />
                    </div>
                    <p className="text-xs text-[#999999] dark:text-zinc-500">Preferências salvas automaticamente</p>
                </div>
            </div>

            {/* Aparência */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                    <div className="w-8 h-8 rounded-lg bg-[#F5A800]/10 flex items-center justify-center shrink-0">
                        <Palette className="w-4 h-4" style={{ color: '#F5A800' }} />
                    </div>
                    <span className="text-base font-semibold text-[#111111] dark:text-white">Aparência</span>
                </div>

                {/* Card content */}
                <div className="p-6">
                    <p className="text-sm text-[#666666] dark:text-zinc-400 mb-3">Selecione o tema da interface</p>
                    <div className="grid grid-cols-2 gap-3">
                        {/* Tema Claro */}
                        <button
                            onClick={() => handleDarkModeChange(false)}
                            className={`border rounded-xl p-4 flex flex-col items-center gap-2 transition-all ${
                                !darkMode
                                    ? 'border-[#F5A800] bg-[#F5A800]/5'
                                    : 'border-[#D1D1D1] dark:border-[#333333] hover:border-[#F5A800]/50'
                            }`}
                        >
                            <Sun className={`w-5 h-5 ${!darkMode ? 'text-[#F5A800]' : 'text-[#666666] dark:text-zinc-400'}`} />
                            <span className={`text-sm font-medium ${!darkMode ? 'text-[#F5A800]' : 'text-[#666666] dark:text-zinc-400'}`}>
                                Claro
                            </span>
                        </button>
                        {/* Tema Escuro */}
                        <button
                            onClick={() => handleDarkModeChange(true)}
                            className={`border rounded-xl p-4 flex flex-col items-center gap-2 transition-all ${
                                darkMode
                                    ? 'border-[#F5A800] bg-[#F5A800]/5'
                                    : 'border-[#D1D1D1] dark:border-[#333333] hover:border-[#F5A800]/50'
                            }`}
                        >
                            <Moon className={`w-5 h-5 ${darkMode ? 'text-[#F5A800]' : 'text-[#666666] dark:text-zinc-400'}`} />
                            <span className={`text-sm font-medium ${darkMode ? 'text-[#F5A800]' : 'text-[#666666] dark:text-zinc-400'}`}>
                                Escuro
                            </span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Metas de Faturamento (Owner) */}
            {isOwner && (
                <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-6 py-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                        <div className="w-8 h-8 rounded-lg bg-[#F5A800]/10 flex items-center justify-center shrink-0">
                            <Target className="w-4 h-4" style={{ color: '#F5A800' }} />
                        </div>
                        <span className="text-base font-semibold text-[#111111] dark:text-white">Metas de Faturamento</span>
                    </div>

                    <div className="p-6 space-y-5">
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Valor <strong>por funcionário</strong>. No Dashboard, a meta de cada loja é este valor
                            multiplicado pelo nº de funcionários ativos (sem instaladores).
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {([
                                ['tier_1', 'Meta 1'],
                                ['tier_2', 'Meta 2'],
                                ['tier_3', 'Meta 3'],
                            ] as const).map(([key, label]) => (
                                <div key={key} className="space-y-1.5">
                                    <Label htmlFor={key} className="text-xs text-[#666666] dark:text-zinc-400">
                                        {label} (R$ por funcionário)
                                    </Label>
                                    <Input
                                        id={key}
                                        type="number"
                                        min={0}
                                        step={100}
                                        value={goals[key]}
                                        onChange={(e) => setGoals((g) => ({ ...g, [key]: e.target.value }))}
                                        disabled={revenueGoalsQuery.isLoading}
                                    />
                                </div>
                            ))}
                        </div>
                        <div>
                            <button
                                onClick={handleSaveGoals}
                                disabled={updateGoals.isPending || revenueGoalsQuery.isLoading}
                                className="h-9 px-4 rounded-lg text-sm font-semibold bg-[#F5A800] hover:bg-[#E09600] text-[#1A1A1A] transition-colors disabled:opacity-60"
                            >
                                {updateGoals.isPending ? 'Salvando…' : 'Salvar metas'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sessão e Segurança */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#E8E8E8] dark:border-[#333333]">
                    <div className="w-8 h-8 rounded-lg bg-[#F5A800]/10 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4" style={{ color: '#F5A800' }} />
                    </div>
                    <span className="text-base font-semibold text-[#111111] dark:text-white">Sessão e Segurança</span>
                </div>

                {/* Card content */}
                <div className="p-6 space-y-5">
                    <div>
                        <p className="text-xs text-[#999999] dark:text-zinc-500 uppercase tracking-wide mb-0.5">Tempo de sessão</p>
                        <p className="text-sm text-[#666666] dark:text-zinc-300">8 horas de inatividade</p>
                    </div>

                    <div className="flex flex-wrap gap-3 pt-1">
                        <button
                            onClick={() => navigate('/change-password')}
                            className="h-9 px-4 rounded-lg text-sm font-medium border border-[#D1D1D1] dark:border-[#333333] text-[#666666] dark:text-zinc-300 transition-colors hover:border-[#F5A800] hover:text-[#F5A800]"
                        >
                            Alterar Senha
                        </button>
                        <button
                            onClick={logout}
                            className="h-9 px-4 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
                        >
                            Encerrar Sessão
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
