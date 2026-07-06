import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  variant?: ToastVariant;
  /** Duração em ms. Default: 3000. */
  duration?: number;
}

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  /** Exibe um toast de feedback (ex.: sucesso/erro de mutation). */
  show: (message: string, options?: ToastOptions) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const META: Record<
  ToastVariant,
  { bg: string; icon: keyof typeof Ionicons.glyphMap; haptic: Haptics.NotificationFeedbackType }
> = {
  success: {
    bg: 'bg-success',
    icon: 'checkmark-circle',
    haptic: Haptics.NotificationFeedbackType.Success,
  },
  error: { bg: 'bg-error', icon: 'alert-circle', haptic: Haptics.NotificationFeedbackType.Error },
  warning: {
    bg: 'bg-warning',
    icon: 'warning',
    haptic: Haptics.NotificationFeedbackType.Warning,
  },
  info: { bg: 'bg-neutral-800', icon: 'information-circle', haptic: Haptics.NotificationFeedbackType.Success },
};

/**
 * Provider de Toast (DS-02). Substitui o `use-toast` do web.
 * Envolva uma vez no topo da árvore (já feito no App.tsx).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      const variant = options?.variant ?? 'info';
      const id = ++seq.current;
      if (timer.current) clearTimeout(timer.current);
      void Haptics.notificationAsync(META[variant].haptic);
      setToast({ id, message, variant });
      timer.current = setTimeout(() => {
        setToast((cur) => (cur?.id === id ? null : cur));
      }, options?.duration ?? 3000);
    },
    []
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m) => show(m, { variant: 'success' }),
      error: (m) => show(m, { variant: 'error' }),
      info: (m) => show(m, { variant: 'info' }),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 top-0 z-50 items-center px-4"
          style={{ paddingTop: insets.top + 8 }}
        >
          <Animated.View entering={FadeInUp} exiting={FadeOutUp} className="w-full">
            <Pressable
              accessibilityRole="alert"
              accessibilityLabel={toast.message}
              onPress={dismiss}
              className={`w-full flex-row items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg ${META[toast.variant].bg}`}
            >
              <Ionicons name={META[toast.variant].icon} size={20} color="#FFFFFF" />
              <Text className="flex-1 font-sans-medium text-sm text-white">{toast.message}</Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

/** Hook de acesso ao Toast (ex.: `const toast = useToast(); toast.success('Salvo')`). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast deve ser usado dentro de <ToastProvider>.');
  }
  return ctx;
}
