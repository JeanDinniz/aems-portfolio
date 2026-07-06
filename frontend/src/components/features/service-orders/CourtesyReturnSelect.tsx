import { useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CourtesyReturnValue {
    is_courtesy: boolean;
    is_return: boolean;
}

export interface CourtesyReturnSelectProps {
    value: CourtesyReturnValue;
    onChange: (value: CourtesyReturnValue) => void;
    isSet?: boolean;
    error?: string;
}

// ─── Option config ────────────────────────────────────────────────────────────

type OptionKey = 'none' | 'courtesy' | 'return';

interface Option {
    key: OptionKey;
    label: string;
}

const OPTIONS: Option[] = [
    { key: 'none',     label: 'Não'      },
    { key: 'courtesy', label: 'Cortesia' },
    { key: 'return',   label: 'Retorno'  },
];

// ─── Shake keyframes injected once ───────────────────────────────────────────

const SHAKE_STYLE_ID = 'courtesy-return-shake-keyframes';

function ensureShakeStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(SHAKE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SHAKE_STYLE_ID;
    style.textContent = `
        @keyframes courtesy-return-shake {
            0%   { transform: translateX(0); }
            15%  { transform: translateX(-4px); }
            30%  { transform: translateX(4px); }
            45%  { transform: translateX(-4px); }
            60%  { transform: translateX(4px); }
            75%  { transform: translateX(-3px); }
            90%  { transform: translateX(3px); }
            100% { transform: translateX(0); }
        }
        .courtesy-return-shake {
            animation: courtesy-return-shake 0.4s ease;
        }
    `;
    document.head.appendChild(style);
}

ensureShakeStyles();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isActive(key: OptionKey, value: CourtesyReturnValue): boolean {
    switch (key) {
        case 'none':     return !value.is_courtesy && !value.is_return;
        case 'courtesy': return value.is_courtesy;
        case 'return':   return value.is_return;
    }
}

function activeCount(value: CourtesyReturnValue): number {
    return (value.is_courtesy ? 1 : 0) + (value.is_return ? 1 : 0);
}

function getTriggerLabel(value: CourtesyReturnValue): string {
    if (value.is_courtesy && value.is_return) return 'Cortesia + Retorno';
    if (value.is_courtesy)                    return 'Cortesia';
    if (value.is_return)                      return 'Retorno';
    return 'Não';
}

function applyClick(key: OptionKey, current: CourtesyReturnValue): CourtesyReturnValue {
    switch (key) {
        case 'none':
            return { is_courtesy: false, is_return: false };

        case 'courtesy':
            if (current.is_courtesy) {
                return { is_courtesy: false, is_return: current.is_return };
            }
            return { is_courtesy: true, is_return: current.is_return };

        case 'return':
            if (current.is_return) {
                return { is_courtesy: current.is_courtesy, is_return: false };
            }
            return { is_courtesy: current.is_courtesy, is_return: true };
    }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CourtesyReturnSelect({ value, onChange, isSet = false, error }: CourtesyReturnSelectProps) {
    const [open, setOpen] = useState(false);
    const [shaking, setShaking] = useState(false);
    const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const triggerShake = () => {
        if (shaking) return;
        setShaking(true);
        if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
        shakeTimeoutRef.current = setTimeout(() => setShaking(false), 500);
    };

    const handleOptionSelect = (key: OptionKey, e: Event) => {
        // Always prevent Radix from auto-closing on select — we control open state manually
        e.preventDefault();

        const currentlyActive = isActive(key, value);

        if (!currentlyActive && key !== 'none' && activeCount(value) >= 2) {
            triggerShake();
            return;
        }

        const next = applyClick(key, value);
        onChange(next);

        // Close only when selecting "Não" (none), keep open for multi-select
        if (key === 'none') {
            setOpen(false);
        }
    };

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'flex h-9 w-36 items-center justify-between gap-2 rounded-md border bg-white dark:bg-[#1A1A1A] px-3 text-sm cursor-pointer',
                        'hover:bg-[#F5F5F5] dark:hover:bg-[#222222] transition-colors',
                        'focus:outline-none focus:border-[#F5A800]',
                        error && !isSet
                            ? 'border-destructive'
                            : 'border-[#D1D1D1] dark:border-[#333333]',
                        shaking && 'courtesy-return-shake',
                    )}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                >
                    <span className={cn(
                        'truncate',
                        !isSet && 'text-muted-foreground',
                        isSet && (value.is_courtesy || value.is_return) && 'font-medium text-[#111111] dark:text-white',
                        isSet && !value.is_courtesy && !value.is_return && 'text-[#111111] dark:text-white',
                    )}>
                        {isSet ? getTriggerLabel(value) : 'Selecionar...'}
                    </span>
                    <ChevronDown className={cn(
                        'h-4 w-4 shrink-0 opacity-50 transition-transform duration-200',
                        open && 'rotate-180',
                    )} />
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                align="start"
                className="w-36 p-1 border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A]"
            >
                {OPTIONS.map((option) => {
                    const active = isSet && isActive(option.key, value);
                    const wouldBlock = !active && option.key !== 'none' && activeCount(value) >= 2;

                    return (
                        <DropdownMenuCheckboxItem
                            key={option.key}
                            checked={active}
                            disabled={wouldBlock}
                            onSelect={(e) => handleOptionSelect(option.key, e)}
                            className={cn(
                                'text-sm text-[#111111] dark:text-white',
                                'focus:bg-[#F5F5F5] dark:focus:bg-[#2A2A2A] focus:text-[#111111] dark:focus:text-white',
                                active && 'bg-[#F5F5F5] dark:bg-[#2A2A2A] font-medium',
                                wouldBlock && 'opacity-50 cursor-not-allowed',
                                // Checkbox indicator: amber border always, filled amber when active
                                '[&>span]:border-2 [&>span]:border-[#F5A800] [&>span]:rounded-sm',
                                active ? '[&>span]:bg-[#F5A800] [&>span]:text-white' : '[&>span]:bg-white dark:[&>span]:bg-[#1A1A1A]',
                            )}
                            title={wouldBlock ? 'Máximo de 2 opções' : undefined}
                        >
                            {option.label}
                        </DropdownMenuCheckboxItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
