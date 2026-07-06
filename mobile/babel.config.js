module.exports = function (api) {
  // Cache varia por NODE_ENV: em teste removemos o transform do NativeWind.
  const isTest = api.cache.using(() => process.env.NODE_ENV === 'test');
  // Em produção (build EAS release), removemos os `console.*` do bundle — exceto
  // `console.error`/`console.warn`, preservados para diagnóstico de campo
  // (ex.: push depurado via `console.warn` + `adb logcat` em release). Em dev e
  // teste nada muda. O Metro define NODE_ENV='production' no build de release.
  const isProd = api.cache.using(() => process.env.NODE_ENV === 'production');

  // Em testes (Jest), o transform de className do NativeWind não é necessário —
  // os componentes renderizam normalmente e o `className` é inerte. Removê-lo no
  // ambiente de teste evita a injeção do helper `_ReactNativeCSSInterop` no escopo
  // de módulo, que o hoisting do `jest.mock()` no jest.setup.js rejeitaria.
  return {
    presets: isTest
      ? ['babel-preset-expo']
      : [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [
      // Resolve o alias `@/` em tempo de compilação (determinístico em qualquer
      // ambiente — local, Expo Go e EAS). Não depender do suporte a tsconfig
      // `paths` do Metro, que é inconsistente no ambiente de build da nuvem.
      [
        'module-resolver',
        {
          root: ['.'],
          alias: { '@': './src' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      // Remove `console.*` do bundle SOMENTE em produção, preservando
      // `error`/`warn`. Precisa vir ANTES do worklets/plugin (que é o último).
      ...(isProd
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
      // react-native-worklets/plugin (Reanimated 4) MUST be the last plugin.
      'react-native-worklets/plugin',
    ],
  };
};
