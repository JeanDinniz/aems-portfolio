import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme';

export interface SelectOption<T extends string | number = string | number> {
  value: T;
  label: string;
  /** Cor opcional (chip/ponto) ao lado do rótulo — ex.: cor de departamento. */
  color?: string;
}

export interface SelectRef {
  present: () => void;
  dismiss: () => void;
}

interface BaseProps<T extends string | number> {
  title?: string;
  options: SelectOption<T>[];
}

interface SingleSelectProps<T extends string | number> extends BaseProps<T> {
  multiple?: false;
  value: T | null | undefined;
  onChange: (value: T) => void;
}

interface MultiSelectProps<T extends string | number> extends BaseProps<T> {
  multiple: true;
  value: T[];
  onChange: (value: T[]) => void;
}

export type SelectProps<T extends string | number = string | number> =
  | SingleSelectProps<T>
  | MultiSelectProps<T>;

/**
 * Sheet de seleção reutilizável (DS-03): lojas, departamentos, status.
 *
 * Seleção única (default): fecha ao escolher.
 * Seleção múltipla (`multiple`): mantém aberto, alterna itens com checkbox.
 *
 * Requer `<BottomSheetModalProvider>` na árvore (já no `App.tsx`).
 */
function SelectInner<T extends string | number>(
  props: SelectProps<T>,
  ref: React.ForwardedRef<SelectRef>
) {
  const { title, options } = props;
  const modalRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();

  // Alturas FIXAS em vez de `enableDynamicSizing`: no Android o dimensionamento
  // por conteúdo media a lista como ~0 e a sheet abria colapsada (só o título,
  // itens abaixo da tela). Com snapPoints o ScrollView preenche e rola.
  const snapPoints = useMemo(() => ['55%', '90%'], []);

  useImperativeHandle(ref, () => ({
    present: () => modalRef.current?.present(),
    dismiss: () => modalRef.current?.dismiss(),
  }));

  const renderBackdrop = useCallback(
    (p: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );

  const isSelected = useCallback(
    (value: T) => {
      if (props.multiple) return props.value.includes(value);
      return props.value === value;
    },
    [props]
  );

  const handlePress = useCallback(
    (value: T) => {
      if (props.multiple) {
        const set = props.value.includes(value)
          ? props.value.filter((v) => v !== value)
          : [...props.value, value];
        props.onChange(set);
      } else {
        props.onChange(value);
        modalRef.current?.dismiss();
      }
    },
    [props]
  );

  return (
    <BottomSheetModal
      ref={modalRef}
      enableDynamicSizing={false}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: isDark ? '#555555' : '#D0D5DD' }}
      backgroundStyle={{ backgroundColor: colors.surface }}
    >
      {title ? (
        <View className="border-b border-neutral-100 px-5 pb-3 pt-1 dark:border-dark-border-soft">
          <Text className="font-display text-lg text-neutral-900 dark:text-dark-text">{title}</Text>
        </View>
      ) : null}
      {/* BottomSheetScrollView (não virtualizado) — o conteúdo é medível pelo
          `enableDynamicSizing`. Com BottomSheetFlatList (virtualizado) a sheet
          colapsava para a altura do título e a lista ficava abaixo da tela. */}
      <BottomSheetScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 12, paddingTop: 4 }}
      >
        {options.map((item) => {
          const selected = isSelected(item.value);
          return (
            <Pressable
              key={String(item.value)}
              accessibilityRole={props.multiple ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: selected }}
              accessibilityLabel={item.label}
              onPress={() => handlePress(item.value)}
              className="min-h-[48px] flex-row items-center gap-3 px-5 py-3 active:bg-neutral-50 dark:active:bg-dark-elevated"
            >
              {item.color ? (
                <View
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
              ) : null}
              <Text
                className={`flex-1 font-sans text-base ${
                  selected
                    ? 'font-sans-semibold text-brand-black dark:text-brand'
                    : 'text-neutral-700 dark:text-dark-text'
                }`}
              >
                {item.label}
              </Text>
              {selected ? (
                <Ionicons
                  name={props.multiple ? 'checkbox' : 'checkmark'}
                  size={20}
                  color={isDark ? '#F5B800' : '#D47F00'}
                />
              ) : props.multiple ? (
                <Ionicons name="square-outline" size={20} color={colors.textMuted} />
              ) : null}
            </Pressable>
          );
        })}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

export const Select = forwardRef(SelectInner) as <T extends string | number = string | number>(
  props: SelectProps<T> & { ref?: React.ForwardedRef<SelectRef> }
) => ReturnType<typeof SelectInner>;
