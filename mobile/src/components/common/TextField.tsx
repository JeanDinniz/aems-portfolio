import { forwardRef } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

/**
 * Campo de texto mínimo com label e mensagem de erro (Sprint 1).
 * Presentacional — usado com `Controller` do react-hook-form. Será substituído
 * pelo Input do design system na DS-02 (Sprint 2).
 */
export interface TextFieldProps extends TextInputProps {
    label?: string;
    error?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
    { label, error, ...props },
    ref
) {
    return (
        <View className="mb-4">
            {label ? (
                <Text className="mb-1.5 text-sm font-semibold text-neutral-700">{label}</Text>
            ) : null}
            <TextInput
                ref={ref}
                placeholderTextColor="#98A2B3"
                className={`rounded-lg border px-4 py-3 text-base text-neutral-900 ${
                    error ? 'border-error' : 'border-neutral-200'
                } bg-white`}
                {...props}
            />
            {error ? <Text className="mt-1 text-sm text-error">{error}</Text> : null}
        </View>
    );
});
