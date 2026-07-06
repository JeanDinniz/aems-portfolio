import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from './Button';

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  /** Rótulo do botão de ação (ex.: "Nova O.S"). */
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * Estado vazio (DS-02): ícone + título + descrição + ação opcional.
 */
export function EmptyState({
  icon = 'file-tray-outline',
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <View className={['flex-1 items-center justify-center px-8 py-12', className ?? ''].join(' ')}>
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-neutral-100 dark:bg-dark-elevated">
        <Ionicons name={icon} size={30} color="#98A2B3" />
      </View>
      <Text className="text-center font-display text-lg text-neutral-800 dark:text-dark-text">
        {title}
      </Text>
      {description ? (
        <Text className="mt-1.5 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View className="mt-6 w-full max-w-[260px]">
          <Button title={actionLabel} variant="primary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
