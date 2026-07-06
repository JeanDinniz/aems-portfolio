import { Text, View, type ViewProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type BadgeVariant =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'purple';

export interface BadgeProps extends ViewProps {
  label: string;
  variant?: BadgeVariant;
  /** Ícone Ionicons à esquerda do rótulo (reforça o significado além da cor). */
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md';
}

// [container bg/border, texto+ícone]
const STYLES: Record<BadgeVariant, { container: string; text: string; icon: string }> = {
  neutral: {
    container: 'bg-neutral-100 dark:bg-dark-elevated',
    text: 'text-neutral-600 dark:text-dark-text-muted',
    icon: '#475467',
  },
  brand: {
    container: 'bg-primary-50 dark:bg-dark-elevated',
    text: 'text-primary-700 dark:text-brand',
    icon: '#D47F00',
  },
  success: {
    container: 'bg-success-light dark:bg-dark-elevated',
    text: 'text-success dark:text-success-dark',
    icon: '#12B76A',
  },
  warning: {
    container: 'bg-warning-light dark:bg-dark-elevated',
    text: 'text-warning dark:text-warning-dark',
    icon: '#F79009',
  },
  error: {
    container: 'bg-error-light dark:bg-dark-elevated',
    text: 'text-error dark:text-error-dark',
    icon: '#F04438',
  },
  info: {
    container: 'bg-info-light dark:bg-dark-elevated',
    text: 'text-info dark:text-info-dark',
    icon: '#2E90FA',
  },
  purple: {
    container: 'bg-purple-light dark:bg-dark-elevated',
    text: 'text-purple dark:text-purple-dark',
    icon: '#7A5AF8',
  },
};

/**
 * Pílula de status/rótulo (DS-02). Status nunca é só cor: aceita ícone + texto.
 */
export function Badge({
  label,
  variant = 'neutral',
  icon,
  size = 'md',
  className,
  ...props
}: BadgeProps) {
  const s = STYLES[variant];
  const pad = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const iconSize = size === 'sm' ? 11 : 13;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      className={[
        'flex-row items-center gap-1 self-start rounded-full',
        pad,
        s.container,
        className ?? '',
      ].join(' ')}
      {...props}
    >
      {icon ? <Ionicons name={icon} size={iconSize} color={s.icon} /> : null}
      <Text className={`font-sans-semibold ${textSize} ${s.text}`}>{label}</Text>
    </View>
  );
}
