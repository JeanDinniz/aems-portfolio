import { ActivityIndicator, Pressable, Text, View, type PressableProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Ícone Ionicons à esquerda do texto. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Ocupa toda a largura disponível. Default: true. */
  fullWidth?: boolean;
}

// Classes por variante: [container, texto, cor do spinner/ícone]
const CONTAINER: Record<ButtonVariant, string> = {
  primary: 'bg-brand active:bg-brand-hover',
  secondary:
    'bg-neutral-100 active:bg-neutral-150 dark:bg-dark-elevated dark:active:bg-dark-border',
  ghost: 'bg-transparent active:bg-neutral-100 dark:active:bg-dark-elevated',
  destructive: 'bg-error active:opacity-90',
};

const LABEL: Record<ButtonVariant, string> = {
  primary: 'text-brand-black',
  secondary: 'text-neutral-700 dark:text-dark-text',
  ghost: 'text-neutral-700 dark:text-dark-text',
  destructive: 'text-white',
};

/**
 * Botão do design system (DS-02).
 * Área de toque ≥ 44pt, estados loading/disabled, ícone opcional.
 */
export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = true,
  disabled,
  ...props
}: ButtonProps) {
  const { isDark } = useTheme();
  const isDisabled = !!disabled || loading;

  const spinnerColor =
    variant === 'primary' ? '#1A1A1A' : variant === 'destructive' ? '#FFFFFF' : isDark ? '#FFFFFF' : '#344054';

  const sizeCls = size === 'sm' ? 'min-h-[44px] px-4 py-2' : 'min-h-[48px] px-6 py-3.5';
  const textSize = size === 'sm' ? 'text-sm' : 'text-base';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={[
        'flex-row items-center justify-center rounded-lg',
        sizeCls,
        CONTAINER[variant],
        fullWidth ? 'w-full' : 'self-start',
        isDisabled ? 'opacity-50' : '',
      ].join(' ')}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <View className="flex-row items-center justify-center gap-2">
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={spinnerColor} /> : null}
          <Text className={`font-sans-bold ${textSize} ${LABEL[variant]}`}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}
