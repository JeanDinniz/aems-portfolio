/**
 * navigationRef — referência global de navegação (PUSH-02).
 *
 * O handler de TOQUE em push (`addNotificationResponseReceivedListener`) e o
 * tratamento de cold-start (`getLastNotificationResponseAsync`) rodam FORA da
 * árvore de componentes, então não têm acesso ao `useNavigation`. Esta ref,
 * anexada ao `NavigationContainer` no App.tsx, permite navegar imperativamente.
 *
 * Use sempre `navigationRef.isReady()` antes de navegar (o container pode ainda
 * não ter montado, ex.: cold start enquanto o RootNavigator decide a rota).
 */
import { createNavigationContainerRef } from '@react-navigation/native';

import type { AppStackParamList, AuthStackParamList } from './types';

/**
 * Tipado contra a UNIÃO dos dois param lists (igual ao `linking`), para que o
 * `ref` do NavigationContainer e o `linking` concordem no mesmo tipo. As ações
 * de push só usam rotas do AppStack (`Tabs`/`Notifications`).
 */
export type RootNavParamList = AppStackParamList & AuthStackParamList;

export const navigationRef = createNavigationContainerRef<RootNavParamList>();
