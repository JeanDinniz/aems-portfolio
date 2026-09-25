import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from './Button';

/**
 * Diálogo de confirmação/aviso do design system (DS-02).
 *
 * Substitui o `Alert.alert` nativo (cinza, sem tema) por um modal customizado,
 * consistente com o dark mode do app: card arredondado, tipografia própria e os
 * botões do design system. Segue o padrão Provider + hook do Toast.
 *
 * Uso:
 *   const { confirm, alert } = useConfirm();
 *   if (await confirm({ title: 'Excluir?', message: '...', destructive: true })) { ... }
 *   await alert({ title: 'Pronto', message: 'Senha alterada.' });
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Rótulo do botão de confirmação. Default: "Confirmar". */
  confirmLabel?: string;
  /** Rótulo do botão de cancelamento. Default: "Cancelar". */
  cancelLabel?: string;
  /** Ação destrutiva → botão vermelho. Default: false. */
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: string;
  /** Rótulo do único botão. Default: "OK". */
  confirmLabel?: string;
}

interface DialogView {
  kind: 'confirm' | 'alert';
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
}

interface ConfirmContextValue {
  /** Abre um diálogo de confirmação (2 botões). Resolve `true` se confirmado. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Abre um aviso modal (1 botão). Resolve quando fechado. */
  alert: (options: AlertOptions) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);

/**
 * Bridge imperativo para chamadas fora da árvore React (ex.: o handler de
 * "sessão encerrada" disparado pelo apiClient). É preenchido pelo provider ao
 * montar; antes disso, degrada para no-op seguro.
 */
let imperativeApi: ConfirmContextValue | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return imperativeApi ? imperativeApi.confirm(options) : Promise.resolve(false);
}

export function alertDialog(options: AlertOptions): Promise<void> {
  return imperativeApi ? imperativeApi.alert(options) : Promise.resolve();
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogView | null>(null);
  // Resolver do diálogo atualmente aberto — fora do state para não executar
  // efeitos dentro do updater do useState (mantém o updater puro).
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  // Abre um diálogo. Se já houver um pendente (ex.: o alerta imperativo de
  // "sessão encerrada" empilhando sobre um confirm do usuário), o anterior é
  // resolvido como cancelado para nunca deixar um awaiter órfão.
  const open = useCallback((view: DialogView, resolve: (value: boolean) => void) => {
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    setState(view);
  }, []);

  const settle = useCallback((result: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    resolve?.(result);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        open(
          {
            kind: 'confirm',
            title: options.title,
            message: options.message,
            confirmLabel: options.confirmLabel ?? 'Confirmar',
            cancelLabel: options.cancelLabel ?? 'Cancelar',
            destructive: options.destructive ?? false,
          },
          resolve
        );
      }),
    [open]
  );

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        open(
          {
            kind: 'alert',
            title: options.title,
            message: options.message,
            confirmLabel: options.confirmLabel ?? 'OK',
            cancelLabel: '',
            destructive: false,
          },
          () => resolve()
        );
      }),
    [open]
  );

  const value = useMemo<ConfirmContextValue>(() => ({ confirm, alert }), [confirm, alert]);

  // Publica/limpa o bridge imperativo enquanto o provider estiver montado.
  useEffect(() => {
    imperativeApi = value;
    return () => {
      if (imperativeApi === value) imperativeApi = null;
    };
  }, [value]);

  const isConfirm = state?.kind === 'confirm';

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        visible={state !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => settle(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar"
          // Toque fora do card: cancela (confirm) ou apenas fecha (alert).
          onPress={() => settle(false)}
          className="flex-1 items-center justify-center bg-black/60 px-8"
        >
          {/* onPress vazio impede que o toque no card feche o modal. */}
          <Pressable
            accessibilityViewIsModal
            onPress={() => {}}
            className="w-full max-w-[400px] rounded-2xl border border-neutral-100 bg-white p-5 shadow-lg dark:border-dark-border-soft dark:bg-dark-surface"
          >
            <Text className="font-display text-lg text-neutral-900 dark:text-dark-text">
              {state?.title}
            </Text>
            {state?.message ? (
              <Text className="mt-2 font-sans text-base leading-relaxed text-neutral-600 dark:text-dark-text-muted">
                {state.message}
              </Text>
            ) : null}

            <View className="mt-6 flex-row justify-end gap-3">
              {isConfirm ? (
                <View className="flex-1">
                  <Button
                    title={state?.cancelLabel || 'Cancelar'}
                    variant="secondary"
                    onPress={() => settle(false)}
                  />
                </View>
              ) : null}
              <View className="flex-1">
                <Button
                  title={state?.confirmLabel ?? 'OK'}
                  variant={state?.destructive ? 'destructive' : 'primary'}
                  onPress={() => settle(true)}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/** Hook de acesso ao diálogo (ex.: `const { confirm } = useConfirm()`). */
export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm deve ser usado dentro de <ConfirmProvider>.');
  }
  return ctx;
}
