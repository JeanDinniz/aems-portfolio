import { forwardRef } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Texto de ajuda exibido abaixo (some quando há erro). */
  hint?: string;
}

/**
 * Campo de texto do design system (DS-02).
 *
 * Presentacional — usar com `Controller` do react-hook-form no consumidor.
 * Espelha o campo legado (`common/TextField`) mas com tokens do DS e tema escuro.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, editable = true, ...props },
  ref
) {
  const { colors } = useTheme();

  return (
    <View className="mb-4">
      {label ? (
        <Text className="mb-1.5 font-sans-semibold text-sm text-neutral-700 dark:text-dark-text">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        editable={editable}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={label}
        className={[
          'rounded-lg border px-4 py-3 font-sans text-base',
          'text-neutral-900 dark:text-dark-text',
          'bg-white dark:bg-dark-input',
          error
            ? 'border-error'
            : 'border-neutral-200 dark:border-dark-border-strong',
          !editable ? 'opacity-60' : '',
        ].join(' ')}
        {...props}
      />
      {error ? (
        <Text className="mt-1 font-sans text-sm text-error">{error}</Text>
      ) : hint ? (
        <Text className="mt-1 font-sans text-sm text-neutral-400 dark:text-dark-text-muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/** Alias semântico — `Input` e `TextField` são o mesmo primitivo. */
export const Input = TextField;
