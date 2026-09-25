import { Check, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MultiSelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface MultiSelectProps<T extends string | number> {
  options: MultiSelectOption<T>[];
  selected: T[];
  onChange: (values: T[]) => void;
  /** Rótulo mostrado quando nada está selecionado (ex.: "Todas"). */
  placeholder?: string;
  /** Sufixo do resumo quando há 2+ selecionados (ex.: "selecionadas"). */
  countLabel?: string;
  /** Classes extras do gatilho (largura/altura seguem o padrão dos filtros). */
  className?: string;
  id?: string;
  ariaLabel?: string;
}

/**
 * Seletor de múltipla escolha (Popover + lista com checkbox). Genérico sobre o
 * tipo do valor (number para loja/marca, string para departamento). Vazio =
 * "sem filtro" — o rótulo do gatilho mostra o placeholder ("Todas").
 */
export function MultiSelect<T extends string | number>({
  options,
  selected,
  onChange,
  placeholder = 'Todas',
  countLabel = 'selecionados',
  className,
  id,
  ariaLabel,
}: MultiSelectProps<T>) {
  const toggle = (value: T) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  const triggerLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? `1 ${countLabel}`)
        : `${selected.length} ${countLabel}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          className={cn(
            // Espelha o SelectTrigger (ui/select.tsx) p/ os filtros ficarem
            // visualmente idênticos — mesmas cores/bordas hardcoded do tema.
            'flex h-8 items-center justify-between gap-2 rounded-md border border-[#D1D1D1] dark:border-[#333333]',
            'bg-white dark:bg-[#1A1A1A] px-3 text-xs text-[#111111] dark:text-white',
            'focus:outline-none focus:border-[#F5A800]',
            className
          )}
        >
          <span
            className={cn(
              'truncate',
              selected.length === 0 && 'text-[#999999] dark:text-zinc-500'
            )}
          >
            {triggerLabel}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="max-h-64 overflow-y-auto">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mb-1 w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            >
              Limpar seleção
            </button>
          )}
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2',
                    checked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-gray-400 bg-white dark:border-gray-500 dark:bg-transparent'
                  )}
                >
                  {checked && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Sem opções</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
