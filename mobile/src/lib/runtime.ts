import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Detecta se o app está rodando dentro do Expo Go (StoreClient).
 *
 * O Expo Go NÃO embute binários nativos de bibliotecas que não fazem parte do
 * runtime padrão (ex.: @shopify/react-native-skia, do qual victory-native
 * depende). Importar essas libs no Expo Go quebra a tela. Use este helper para
 * degradar graciosamente: no Expo Go mostramos um aviso; no dev build / produção
 * (StandaloneApp ou Bare) carregamos os gráficos.
 *
 * Mantido isolado em sua própria função para ser facilmente mockável nos testes.
 */
export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}
