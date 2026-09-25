import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuração Expo do app mobile AEMS (AEMS).
 *
 * Fonte única de configuração — substitui o antigo app.json.
 *
 * `extra` é lido por `src/lib/env.ts`:
 *  - Em desenvolvimento (__DEV__), o env.ts deriva a URL da API do IP do Metro
 *    (hostUri), então API_URL/WS_URL podem ficar vazios aqui.
 *  - Em staging/produção, o eas.json injeta APP_ENV/API_URL/WS_URL via env do
 *    perfil de build, que são lidos abaixo de process.env.
 */

// projectId do EAS (gerado por `eas init`). Pode ser sobrescrito por env em CI.
const easProjectId = process.env.EAS_PROJECT_ID ?? '705d78fb-d02d-465b-9201-2932b2fe17d8';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'AEMS',
  slug: 'aems-mobile',
  owner: 'jeandinniz',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  // 'automatic' é obrigatório para o tema claro/escuro manual funcionar: o
  // NativeWind v4 nativo resolve o esquema exclusivamente via Appearance do RN
  // (`colorScheme.set` chama `Appearance.setColorScheme`). Com 'light' o SO
  // ignora a troca de esquema e as variantes `dark:` nunca aplicam. Mudança de
  // config NATIVA — exige novo dev/production build para valer (no Expo Go o
  // container já é 'automatic').
  userInterfaceStyle: 'automatic',
  scheme: 'aems',
  // ─── EAS Update / OTA (REL-04) ──────────────────────────────────────────────
  // Permite publicar correções de JS/assets sem nova submissão à loja
  // (`eas update`). A URL usa o projectId REAL do EAS. O comportamento padrão do
  // expo-updates é "check on launch" — nenhuma UI adicional é necessária na v1.
  // IMPORTANTE: OTA só funciona em BUILDS que já embarcam o expo-updates. Os dev
  // build/preview/production ANTERIORES a esta mudança NÃO recebem update — é
  // preciso um NOVO build depois de adicionar este módulo.
  updates: {
    url: `https://u.expo.dev/${easProjectId}`,
  },
  // runtimeVersion define a "compatibilidade nativa" de um update: um build só
  // aplica updates com runtimeVersion igual. Policy `appVersion` = a versão nativa
  // é a própria `version` (semver acima). Escolha pela SIMPLICIDADE para time solo:
  //  - Mudou SÓ JS  → `eas update` no canal; mesmo `version` → update aplica.
  //  - Mudou NATIVO (novo módulo/config/plugin) → BUMP manual de `version` +
  //    novo build. O bump invalida OTAs antigas automaticamente (evita entregar
  //    JS incompatível com o binário novo).
  // Trade-off vs. `fingerprint` (que recalcula um hash do estado nativo a cada
  // mudança e invalida OTA sozinho): `fingerprint` é mais seguro contra esquecer
  // o bump, porém o runtimeVersion vira um hash opaco, dificulta rastrear "qual
  // build recebe qual update" e muda a cada alteração nativa mesmo trivial.
  // `appVersion` mantém o controle explícito e legível — adequado ao ritmo solo.
  runtimeVersion: { policy: 'appVersion' },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.example.aems',
    // Push (APNs): habilita o background mode de notificação remota. As
    // credenciais APNs (.p8) são geridas pelo EAS (`eas credentials`), não aqui.
    // SLOT iOS — após baixar o GoogleService-Info.plist do Firebase (se for usar
    // FCM no iOS), coloque-o em `./GoogleService-Info.plist` e referencie em
    // `ios.googleServicesFile: './GoogleService-Info.plist'`. NÃO commitar o
    // arquivo (já está no .gitignore). Para Expo Push API pura (sem FCM no iOS),
    // basta a APNs key no EAS — o plist não é necessário.
    infoPlist: {
      NSCameraUsageDescription:
        'O app usa a câmera para registrar fotos das ordens de serviço.',
      NSPhotoLibraryUsageDescription:
        'O app acessa suas fotos para anexar imagens às ordens de serviço.',
      NSLocationWhenInUseUsageDescription:
        'Usamos sua localização para registrar o local da batida de ponto.',
      UIBackgroundModes: ['remote-notification'],
    },
  },
  android: {
    package: 'com.example.aems',
    // HML/prod agora são HTTPS (hml.aems.example.com / aems.example.com),
    // então cleartext HTTP não é necessário. Se um dia precisar (ex.: HTTP por IP),
    // use o plugin `expo-build-properties` com android.usesCleartextTraffic — a key
    // NÃO existe direto no ExpoConfig.android (erro de tsc).
    adaptiveIcon: {
      backgroundColor: '#1A1A1A',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['CAMERA', 'POST_NOTIFICATIONS', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    // SLOT Android (OBRIGATÓRIO para push em produção). O `google-services.json`
    // NÃO é commitado (está no .gitignore). No build EAS ele é injetado via file
    // env var (secret) `GOOGLE_SERVICES_JSON` — o EAS baixa o arquivo e expõe o
    // caminho em process.env. Localmente (sem a env) cai no arquivo da raiz.
    // Sem isso, o build não entrega push no Android.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-secure-store',
    'expo-font',
    [
      'expo-camera',
      {
        cameraPermission:
          'O app usa a câmera para registrar fotos das ordens de serviço.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'O app acessa suas fotos para anexar imagens às ordens de serviço.',
      },
    ],
    [
      // Localização (Ponto Eletrônico). Só uso em foreground (batida de ponto);
      // não pedimos permissão de background. O plugin declara
      // NSLocationWhenInUseUsageDescription (iOS) e as permissões ACCESS_*
      // LOCATION (Android). Módulo NATIVO novo — exige um novo dev/production
      // build para o expo-location funcionar (não roda por OTA nem no Expo Go
      // sem o binário atualizado).
      'expo-location',
      {
        locationWhenInUsePermission:
          'Usamos sua localização para registrar o local da batida de ponto.',
      },
    ],
    [
      'expo-notifications',
      {
        // Cor de acento da notificação (Android). `icon` omitido de propósito:
        // não há um asset monocromático/transparente dedicado para o ícone de
        // status bar; o Expo usa o padrão. Quando houver um ícone branco/transp.
        // 96x96, adicionar aqui `icon: './assets/notification-icon.png'`.
        color: '#F5B800',
      },
    ],
    [
      // Biometria (HARD-01). No iOS o plugin declara NSFaceIDUsageDescription.
      // No Android o plugin cuida das permissões USE_BIOMETRIC/USE_FINGERPRINT.
      'expo-local-authentication',
      {
        faceIDPermission:
          'O app usa o Face ID para desbloquear o acesso sem digitar a senha novamente.',
      },
    ],
    [
      // Reconhecimento facial do Ponto (Fase 1 — enrollment). O plugin do
      // react-native-fast-tflite ajusta a config nativa (iOS/Android) para o
      // runtime do TensorFlow Lite. Mantemos CPU-only (sem CoreML delegate) na
      // v1 por simplicidade — o FaceNet ~94MB é temporário e será trocado por um
      // MobileFaceNet pequeno. Módulo NATIVO novo → exige novo dev/production
      // build (não roda por OTA nem no Expo Go). O `@react-native-ml-kit/face-detection`
      // NÃO tem config plugin — é autolinkado pelo `expo prebuild`.
      'react-native-fast-tflite',
      {
        enableCoreMLDelegate: false,
      },
    ],
    // Resolve o .tflite embarcado para um caminho file:// real (necessário no
    // build de RELEASE — o require() do asset vinha sem esquema de URL e o
    // fast-tflite falhava com "no protocol: assets_models_facenet").
    'expo-asset',
    [
      // Sentry source maps (HARD-02): faz upload dos source maps/símbolos no
      // build EAS para stack traces legíveis nos crashes. O `authToken` NÃO fica
      // no código — o sentry-cli o lê do env `SENTRY_AUTH_TOKEN` (EAS secret) no
      // build; sem o token, o upload é pulado (o build não quebra). Combina com
      // `getSentryExpoConfig` no metro.config.js (gera os source maps).
      '@sentry/react-native/expo',
      {
        organization: 'aems-ol',
        project: 'wash-center-mobile',
      },
    ],
  ],
  extra: {
    env: process.env.APP_ENV ?? 'development',
    apiUrl: process.env.API_URL ?? '',
    wsUrl: process.env.WS_URL ?? '',
    // Crash reporting (HARD-02). VAZIO por padrão: sem DSN o Sentry NÃO
    // inicializa (no-op total, zero overhead — o app roda idêntico a hoje).
    // Quando o PO criar o projeto Sentry, injeta o DSN como EAS secret
    // `SENTRY_DSN` nos perfis preview/production (ver eas.json) — sem mudar
    // código. Lido por `src/lib/env.ts` (extra.sentryDsn). Ver `src/lib/sentry.ts`.
    sentryDsn: process.env.SENTRY_DSN ?? '',
    // Feature flags de módulos secundários (default OFF — ver src/constants/features.ts).
    // Habilitar por perfil no eas.json (env) ou em dev: `FEATURE_DASHBOARD=true npx expo start`.
    featureConference: process.env.FEATURE_CONFERENCE ?? '',
    featureFechamento: process.env.FEATURE_FECHAMENTO ?? '',
    featureDashboard: process.env.FEATURE_DASHBOARD ?? '',
    featureInstallerPerformance: process.env.FEATURE_INSTALLER_PERFORMANCE ?? '',
    featureEbook: process.env.FEATURE_EBOOK ?? '',
    featureAdminCadastros: process.env.FEATURE_ADMIN_CADASTROS ?? '',
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
});
