import { View, type ViewProps } from 'react-native';

export interface CardProps extends ViewProps {
  /** Padding interno. Default: true (p-4). Use false para controlar manualmente. */
  padded?: boolean;
}

/**
 * Container base de cards (DS-02). Fundo de superfície, raio 2xl, sombra discreta.
 * Base de OSCard, RollCard, etc.
 */
export function Card({ padded = true, className, children, ...props }: CardProps) {
  return (
    <View
      className={[
        'rounded-2xl border border-neutral-100 bg-white shadow-sm',
        'dark:border-dark-border-soft dark:bg-dark-surface',
        padded ? 'p-4' : '',
        className ?? '',
      ].join(' ')}
      {...props}
    >
      {children}
    </View>
  );
}
