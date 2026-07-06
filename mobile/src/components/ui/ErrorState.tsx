import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from './Button';

export interface ErrorStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title?: string;
  description?: string;
  /** Rótulo do botão de retry. Default: "Tentar novamente". */
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Estado de erro (DS-02): ícone + texto + ação de retry.
 */
export function ErrorState({
  icon = 'cloud-offline-outline',
  title = 'Algo deu errado',
  description = 'Não foi possível carregar os dados. Verifique sua conexão e tente novamente.',
  retryLabel = 'Tentar novamente',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <View className={['flex-1 items-center justify-center px-8 py-12', className ?? ''].join(' ')}>
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-error-light dark:bg-dark-elevated">
        <Ionicons name={icon} size={30} color="#F04438" />
      </View>
      <Text className="text-center font-display text-lg text-neutral-800 dark:text-dark-text">
        {title}
      </Text>
      {description ? (
        <Text className="mt-1.5 text-center font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
          {description}
        </Text>
      ) : null}
      {onRetry ? (
        <View className="mt-6 w-full max-w-[260px]">
          <Button title={retryLabel} variant="secondary" icon="refresh" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}
