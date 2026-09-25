import { useCallback } from 'react';
import { Switch, Text, View } from 'react-native';

import { useConfirm } from '@/components/ui';
import { brand, neutral } from '@/theme/tokens';

/**
 * Switch de Ativar/Desativar padronizado dos catálogos Admin (Fatia 5 — UX).
 *
 * Comportamento (igual nas 6 telas de catálogo):
 * - Ligado → desligado (DESATIVAR): ação destrutiva. Abre o diálogo `confirm` do
 *   design system; só chama `onToggle(false)` se confirmar. Ao cancelar, nada muta
 *   (o `value` permanece ligado, pois a fonte de verdade é a query).
 * - Desligado → ligado (ATIVAR): ação não destrutiva. Aplica direto `onToggle(true)`.
 * - `pending`: desabilita o switch e reduz a opacidade enquanto a mutação roda.
 *
 * Layout: rótulo curto "Ativa/Inativa" + Switch à direita (sem competir com Badge).
 */
export interface ToggleActiveSwitchProps {
    /** Estado atual (fonte de verdade: o item da query). */
    value: boolean;
    /** Nome do item, usado na mensagem de confirmação. */
    itemName: string;
    /** Substantivo do recurso, ex.: "loja", "marca", "serviço". */
    resourceLabel: string;
    /** Rótulos de estado (default: Ativo/Inativo). Algumas telas usam femininos. */
    activeLabel?: string;
    inactiveLabel?: string;
    /** Dispara a mutação com o próximo estado. */
    onToggle: (next: boolean) => void;
    /** Mutação daquele item em andamento. */
    pending?: boolean;
}

export function ToggleActiveSwitch({
    value,
    itemName,
    resourceLabel,
    activeLabel = 'Ativo',
    inactiveLabel = 'Inativo',
    onToggle,
    pending = false,
}: ToggleActiveSwitchProps) {
    const { confirm } = useConfirm();
    const handleChange = useCallback(
        async (next: boolean) => {
            if (next) {
                // Ativar: direto, sem confirmação.
                onToggle(true);
                return;
            }
            // Desativar: confirma antes (destrutivo).
            const ok = await confirm({
                title: `Desativar ${resourceLabel}`,
                message: `Desativar ${itemName}?`,
                confirmLabel: 'Desativar',
                destructive: true,
            });
            if (ok) onToggle(false);
        },
        [confirm, itemName, onToggle, resourceLabel]
    );

    return (
        <View
            className="flex-row items-center gap-2"
            style={{ opacity: pending ? 0.5 : 1 }}
        >
            <Text
                className={`font-sans-semibold text-xs ${
                    value
                        ? 'text-success dark:text-success-dark'
                        : 'text-neutral-400 dark:text-dark-text-muted'
                }`}
            >
                {value ? activeLabel : inactiveLabel}
            </Text>
            <Switch
                accessibilityRole="switch"
                accessibilityLabel={`${value ? activeLabel : inactiveLabel}: ${itemName}`}
                accessibilityState={{ checked: value, disabled: pending }}
                value={value}
                onValueChange={handleChange}
                disabled={pending}
                trackColor={{ false: neutral[200], true: brand.DEFAULT }}
                thumbColor={value ? brand.black : neutral[50]}
                ios_backgroundColor={neutral[200]}
            />
        </View>
    );
}
