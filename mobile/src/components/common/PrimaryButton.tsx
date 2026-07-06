import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';

/**
 * Botão primário mínimo (Sprint 1). Variante sólida (âmbar) e outline.
 * Será substituído pelo Button do design system na DS-02 (Sprint 2).
 */
export interface PrimaryButtonProps extends Omit<PressableProps, 'children'> {
    title: string;
    loading?: boolean;
    variant?: 'solid' | 'outline';
}

export function PrimaryButton({
    title,
    loading = false,
    variant = 'solid',
    disabled,
    ...props
}: PrimaryButtonProps) {
    const isDisabled = disabled || loading;
    const solid = variant === 'solid';

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!isDisabled, busy: loading }}
            disabled={isDisabled}
            className={`min-h-[48px] flex-row items-center justify-center rounded-lg px-6 py-3.5 active:opacity-80 ${
                solid ? 'bg-brand' : 'border border-neutral-300 bg-transparent'
            } ${isDisabled ? 'opacity-50' : ''}`}
            {...props}
        >
            {loading ? (
                <ActivityIndicator color={solid ? '#1A1A1A' : '#475467'} />
            ) : (
                <Text
                    className={`text-base font-bold ${
                        solid ? 'text-brand-black' : 'text-neutral-700'
                    }`}
                >
                    {title}
                </Text>
            )}
        </Pressable>
    );
}
