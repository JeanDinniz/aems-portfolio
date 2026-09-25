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
  /**
   * Item travado: renderiza com cadeado, não seleciona. Tocar dispara
   * `onDisabledPress` (ex.: bobina lacrada → abrir para uso), se fornecido.
   */
  disabled?: boolean;
  /** Legenda secundária abaixo do rótulo (ex.: "lacrada — abra antes de usar"). */
  hint?: string;
}

export interface SelectRef {
  present: () => void;
  dismiss: () => void;
}

interface BaseProps<T extends string | number> {
  title?: string;
  options: SelectOption<T>[];
  /** Chamado ao tocar um item `disabled` (não altera a seleção). */
  onDisabledPress?: (value: T) => void;
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
      // `stackBehavior="push"` (em vez do default 'switch'): quando este Select é
      // aberto por cima de um Sheet já presente (ex.: CreateWithdrawalSheet), o
      // 'switch' MINIMIZA o Sheet pai — e como os Selects são renderizados DENTRO
      // do conteúdo portalizado do pai, minimizar o pai desmonta o portal do filho
      // e o Select "fecha sozinho" antes de terminar de abrir. Com 'push' o pai
      // permanece montado e o Select empilha por cima.
      stackBehavior="push"
      enableDynamicSizing={false}
      snapPoints={snapPoints}
      bottomInset={insets.bottom}
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
        contentContainerStyle={{ paddingBottom: 12, paddingTop: 4 }}
      >
        {options.map((item) => {
          const selected = isSelected(item.value);
          if (item.disabled) {
            // Item travado: cadeado + legenda, não seleciona. Tocar dispara
            // onDisabledPress (ex.: abrir bobina lacrada) quando fornecido.
            return (
              <Pressable
                key={String(item.value)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ disabled: true }}
                disabled={!props.onDisabledPress}
                onPress={() => props.onDisabledPress?.(item.value)}
                className="min-h-[48px] flex-row items-center gap-3 px-5 py-3 active:bg-neutral-50 dark:active:bg-dark-elevated"
              >
                <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                <View className="flex-1">
                  <Text className="font-sans text-base text-neutral-400 dark:text-dark-text-muted">
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text className="font-sans text-xs text-neutral-400 dark:text-dark-text-muted">
                      {item.hint}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }
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
