import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Text, View } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

export interface SheetRef {
  present: () => void;
  dismiss: () => void;
}

export interface SheetProps {
  /** Título exibido no topo do sheet. */
  title?: string;
  children: ReactNode;
  /** Snap points (ex.: ['50%']). Default: conteúdo dinâmico. */
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
}

/**
 * Bottom sheet do design system (DS-03) sobre `@gorhom/bottom-sheet` v5.
 *
 * Requer `<BottomSheetModalProvider>` na árvore (já adicionado no `App.tsx`).
 * Use via ref: `const ref = useRef<SheetRef>(null); ref.current?.present()`.
 */
export const Sheet = forwardRef<SheetRef, SheetProps>(function Sheet(
  { title, children, snapPoints, onDismiss },
  ref
) {
  const modalRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const { isDark, colors } = useTheme();

  useImperativeHandle(ref, () => ({
    present: () => modalRef.current?.present(),
    dismiss: () => modalRef.current?.dismiss(),
  }));

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    []
  );

  const computedSnapPoints = useMemo(() => snapPoints, [snapPoints]);

  return (
    <BottomSheetModal
      ref={modalRef}
      snapPoints={computedSnapPoints}
      enableDynamicSizing={!snapPoints}
      onDismiss={onDismiss}
      backdropComponent={renderBackdrop}
      // Teclado: o sheet sobe junto com o teclado (input nunca fica escondido) e
      // arrastar/tocar fora minimiza o teclado em vez de fechar o sheet.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleIndicatorStyle={{ backgroundColor: isDark ? '#555555' : '#D0D5DD' }}
      backgroundStyle={{ backgroundColor: colors.surface }}
    >
      <BottomSheetView style={{ paddingBottom: insets.bottom + 16 }}>
        {title ? (
          <View className="border-b border-neutral-100 px-5 pb-3 pt-1 dark:border-dark-border-soft">
            <Text className="font-display text-lg text-neutral-900 dark:text-dark-text">
              {title}
            </Text>
          </View>
        ) : null}
        <View className="px-5 pt-3">{children}</View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});
