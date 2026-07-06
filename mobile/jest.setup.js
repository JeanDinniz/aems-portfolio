/* eslint-disable @typescript-eslint/no-require-imports */
// Setup global de testes (Jest + Testing Library).
// Mocks dos módulos nativos que não rodam em ambiente Node.

// AsyncStorage — mock oficial.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// expo-secure-store — armazenamento em memória para os testes.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

// expo-constants — hostUri previsível em testes. `executionEnvironment` default
// = 'standalone' (NÃO Expo Go), para que isExpoGo() seja false por padrão; os
// testes que precisam do branch Expo Go mockam '@/lib/runtime' diretamente.
jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: {
    Bare: 'bare',
    Standalone: 'standalone',
    StoreClient: 'storeClient',
  },
  default: {
    executionEnvironment: 'standalone',
    expoConfig: { hostUri: '127.0.0.1:8081', extra: {}, version: '1.0.0' },
  },
}));

// nativewind — no ambiente de teste o runtime de CSS/className é desativado
// (ver babel.config.js), então `useColorScheme().setColorScheme` lança
// ("Unable to manually set color scheme without darkMode: class") por não ter o
// runtime inicializado. Mockamos o hook: `colorScheme` controlável via
// global.mockColorScheme e `setColorScheme` vira um no-op que atualiza o mock.
// Em device/produção o NativeWind real é usado (darkMode: 'class' no tailwind).
global.mockColorScheme = 'light';
jest.mock('nativewind', () => ({
  __esModule: true,
  useColorScheme: () => ({
    colorScheme: global.mockColorScheme,
    setColorScheme: jest.fn((next) => {
      global.mockColorScheme = next === 'dark' ? 'dark' : 'light';
    }),
    toggleColorScheme: jest.fn(),
  }),
  // `cssInterop`/`remapProps` são no-ops nos testes (className já é ignorado).
  cssInterop: jest.fn(),
  remapProps: jest.fn(),
  vars: jest.fn(() => ({})),
}));

// @sentry/react-native — crash reporting (HARD-02). Mock simples: `init`,
// `wrap` (retorna o componente intacto), `addBreadcrumb`, `captureException`,
// `setUser`. A lógica de ligar/desligar por DSN vive em src/lib/sentry.ts e é
// testada lá mockando @/lib/env. Aqui só evitamos carregar o nativo.
jest.mock('@sentry/react-native', () => ({
  __esModule: true,
  init: jest.fn(),
  wrap: jest.fn((component) => component),
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  setUser: jest.fn(),
}));

// @shopify/react-native-skia — binários nativos; mockamos os símbolos que o
// ChartsSection (via victory-native) pode tocar como Views/no-ops.
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const { View } = require('react-native');
  const passthrough = ({ children }) => React.createElement(View, null, children);
  return {
    __esModule: true,
    Canvas: passthrough,
    Group: passthrough,
    Path: () => null,
    Circle: () => null,
    Rect: () => null,
    Text: () => null,
    useFont: () => null,
    Skia: {},
    matchFont: () => null,
  };
});

// victory-native — gráficos Skia mockados. CartesianChart invoca seu child como
// render-prop com {points, chartBounds}; PolarChart renderiza os filhos. Os
// componentes de série (Line/Area/Bar/BarGroup/Pie) viram no-ops/Views, pois os
// testes verificam títulos/legendas/RN <Text>, não pixels do Skia.
jest.mock('victory-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const noop = () => null;
  const CartesianChart = ({ children }) => {
    const rendered =
      typeof children === 'function'
        ? children({ points: {}, chartBounds: { left: 0, right: 0, top: 0, bottom: 0 } })
        : children;
    return React.createElement(View, null, rendered);
  };
  const PolarChart = ({ children }) =>
    React.createElement(View, null, typeof children === 'function' ? children({}) : children);
  const Pie = {
    Chart: ({ children }) =>
      React.createElement(
        View,
        null,
        typeof children === 'function' ? children({ slice: {} }) : children
      ),
    Slice: noop,
    SliceAngularInset: noop,
  };
  const BarGroup = ({ children }) => React.createElement(View, null, children);
  BarGroup.Bar = noop;
  return {
    __esModule: true,
    CartesianChart,
    PolarChart,
    Line: noop,
    Area: noop,
    Bar: noop,
    BarGroup,
    Pie,
  };
});

// ─── Mocks nativos do Sprint 2 (câmera / fotos / upload / UI) ────────────────
// Reutilizáveis por todos os testes. Não devem quebrar os testes existentes:
// só mockam módulos nativos que não rodam no jsdom/Node.
//
// NOTA: o transform de className do NativeWind é desativado no ambiente de teste
// (ver babel.config.js), então estas factories podem usar componentes
// `react-native` reais sem injetar `_ReactNativeCSSInterop` no escopo de módulo.

// @expo/vector-icons — ícones viram uma View vazia (sem fontes nativas), mas
// preservam props de acessibilidade para as queries dos testes.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const makeIcon = () => {
    const Icon = ({ accessibilityLabel, testID }) =>
      React.createElement(View, { accessibilityLabel, testID });
    // Alguns componentes acessam Icon.glyphMap; basta existir.
    Icon.glyphMap = {};
    return Icon;
  };
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return makeIcon();
      },
    }
  );
});

// expo-image — Image vira uma View leve (sem decodificação nativa).
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    Image: ({ accessibilityLabel, testID, style }) =>
      React.createElement(View, { accessibilityLabel, testID, style }),
  };
});

// expo-haptics — no-ops (não há hardware de vibração nos testes).
jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// expo-image-picker — câmera/galeria mockadas; default = permissão concedida e
// um asset fixo. Testes sobrescrevem com mockResolvedValueOnce conforme o caso.
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  launchCameraAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///cam.jpg', width: 4000, height: 3000, mimeType: 'image/jpeg', fileName: 'cam.jpg' }],
  })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///lib.jpg', width: 4000, height: 3000, mimeType: 'image/jpeg', fileName: 'lib.jpg' }],
  })),
}));

// expo-image-manipulator — API contextual v14:
//   ImageManipulator.manipulate(uri) → context (.resize().renderAsync())
//   renderAsync() → ref (.saveAsync()) → { uri, width, height }
// `mockManipulatorState` permite aos testes inspecionar/forçar comportamento.
global.mockManipulatorState = {
  resizeCalls: [],
  saveCalls: [],
  // Hook opcional: testes podem setar para introduzir atraso/erro na renderização.
  onRender: null,
};
jest.mock('expo-image-manipulator', () => {
  const state = global.mockManipulatorState;
  const makeContext = (uri) => {
    const ctx = {
      resize: (target) => {
        state.resizeCalls.push(target);
        return ctx;
      },
      renderAsync: async () => {
        if (typeof state.onRender === 'function') {
          await state.onRender();
        }
        return {
          uri: `${uri}.out`,
          width: 1600,
          height: 1200,
          saveAsync: async (opts) => {
            state.saveCalls.push(opts);
            return { uri: `${uri}.jpg`, width: 1600, height: 1200 };
          },
        };
      },
    };
    return ctx;
  };
  return {
    __esModule: true,
    ImageManipulator: {
      manipulate: (uri) => makeContext(uri),
    },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  };
});

// expo-file-system — API v19 (File/Directory/Paths). `File.size` é controlável
// via global.mockFileSize; o "filesystem" é um Set em memória de URIs existentes
// (global.mockFileSystemFiles) para copy/exists/delete da fila de upload.
global.mockFileSize = 500 * 1024; // 500 KB (dentro do limite de 10 MB)
global.mockFileSystemFiles = new Set(); // URIs que "existem" (copy/create os populam)
global.mockFileWrites = []; // chamadas de File.write (exportação de Excel)
jest.mock('expo-file-system', () => {
  const join = (...parts) =>
    parts
      .map((p) => (typeof p === 'string' ? p : p.uri))
      .join('/')
      .replace(/\/+/g, '/')
      .replace(':/', '://'); // preserva file://

  class File {
    constructor(...uris) {
      this.uri = join(...uris);
    }
    get size() {
      return global.mockFileSize;
    }
    get exists() {
      return global.mockFileSystemFiles.has(this.uri);
    }
    create() {
      global.mockFileSystemFiles.add(this.uri);
    }
    copy(dest) {
      const destUri = typeof dest === 'string' ? dest : dest.uri;
      global.mockFileSystemFiles.add(destUri);
    }
    // write(content, { encoding }) — usado pela exportação de Excel (v19).
    // Registra a chamada em global.mockFileWrites para os testes inspecionarem.
    write(content, options) {
      global.mockFileSystemFiles.add(this.uri);
      global.mockFileWrites.push({ uri: this.uri, content, options });
    }
    delete() {
      global.mockFileSystemFiles.delete(this.uri);
    }
  }

  class Directory {
    constructor(...uris) {
      this.uri = join(...uris);
    }
    get exists() {
      return global.mockFileSystemFiles.has(this.uri);
    }
    create() {
      global.mockFileSystemFiles.add(this.uri);
    }
    delete() {
      global.mockFileSystemFiles.delete(this.uri);
    }
  }

  const Paths = {
    get document() {
      return new Directory('file:///app-documents');
    },
    get cache() {
      return new Directory('file:///app-cache');
    },
  };

  return { __esModule: true, File, Directory, Paths };
});

// expo-modules-core — sonda de módulo nativo opcional. Nos testes retorna truthy
// por padrão para os probes de expo-sharing/expo-clipboard passarem no happy-path.
// `global.mockOptionalNativeModule` permite forçar ausência (probe → null).
global.mockOptionalNativeModule = { available: true };
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');
  return {
    ...actual,
    requireOptionalNativeModule: jest.fn(() =>
      global.mockOptionalNativeModule.available ? {} : null
    ),
  };
});

// expo-sharing — disponível por padrão; shareAsync resolve. `global.mockSharing`
// permite forçar indisponibilidade (isAvailableAsync → false) nos testes.
global.mockSharing = { available: true };
jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn(async () => global.mockSharing.available),
  shareAsync: jest.fn(async () => undefined),
}));

// expo-clipboard — captura o texto copiado (senha temporária no Admin).
global.mockClipboard = { text: null };
jest.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: jest.fn(async (value) => {
    global.mockClipboard.text = value;
    return true;
  }),
  getStringAsync: jest.fn(async () => global.mockClipboard.text ?? ''),
}));

// @react-native-community/netinfo — listeners controláveis nos testes.
// global.mockNetInfo expõe os listeners para disparar reconexão manualmente.
global.mockNetInfo = { listeners: new Set() };
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn((listener) => {
      global.mockNetInfo.listeners.add(listener);
      return () => global.mockNetInfo.listeners.delete(listener);
    }),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
  addEventListener: jest.fn((listener) => {
    global.mockNetInfo.listeners.add(listener);
    return () => global.mockNetInfo.listeners.delete(listener);
  }),
}));

// expo-device — controla se o ambiente é um device físico. Default: true.
// Testes ajustam via `global.mockIsDevice = false` para o branch de emulador.
global.mockIsDevice = true;
jest.mock('expo-device', () => ({
  __esModule: true,
  get isDevice() {
    return global.mockIsDevice;
  },
}));

// expo-notifications — push mockado. `global.mockPush` controla permissão e
// token, e expõe os listeners de resposta para os testes dispararem toques.
global.mockPush = {
  permission: { granted: true, canAskAgain: true, status: 'granted' },
  requestResult: { granted: true, canAskAgain: true, status: 'granted' },
  token: { data: 'ExponentPushToken[xxxxxxxx]' },
  getTokenThrows: false, // simula Expo Go (getExpoPushTokenAsync lança)
  lastResponse: null, // simula cold-start por toque
  responseListeners: new Set(),
};
jest.mock('expo-notifications', () => ({
  __esModule: true,
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => global.mockPush.permission),
  requestPermissionsAsync: jest.fn(async () => global.mockPush.requestResult),
  getExpoPushTokenAsync: jest.fn(async () => {
    if (global.mockPush.getTokenThrows) {
      throw new Error('getExpoPushTokenAsync not supported in Expo Go');
    }
    return global.mockPush.token;
  }),
  getLastNotificationResponseAsync: jest.fn(async () => global.mockPush.lastResponse),
  addNotificationResponseReceivedListener: jest.fn((listener) => {
    global.mockPush.responseListeners.add(listener);
    return { remove: jest.fn(() => global.mockPush.responseListeners.delete(listener)) };
  }),
}));

// expo-local-authentication — biometria mockada (HARD-01). `global.mockBiometrics`
// controla hardware/cadastro, tipos suportados e o resultado do prompt.
global.mockBiometrics = {
  hasHardware: true,
  isEnrolled: true,
  supportedTypes: [1], // 1 = FINGERPRINT (ver AuthenticationType abaixo)
  authenticateResult: { success: true },
};
jest.mock('expo-local-authentication', () => ({
  __esModule: true,
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: jest.fn(async () => global.mockBiometrics.hasHardware),
  isEnrolledAsync: jest.fn(async () => global.mockBiometrics.isEnrolled),
  supportedAuthenticationTypesAsync: jest.fn(async () => global.mockBiometrics.supportedTypes),
  authenticateAsync: jest.fn(async () => global.mockBiometrics.authenticateResult),
}));

// expo-camera — componentes/permissões mockados (não usado direto nos testes,
// mas evita carregar o nativo se algum módulo importar).
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CameraView: ({ testID }) => React.createElement(View, { testID }),
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

// @gorhom/bottom-sheet — provider e componentes passthrough; o modal expõe
// present/dismiss via ref para os testes acionarem o conteúdo.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View, TextInput } = require('react-native');
  const Passthrough = React.forwardRef((props, ref) => {
    // `dismiss`/`close` disparam o callback `onDismiss` como o componente real
    // faz ao concluir a animação de fechamento. PhotoCapture depende disso para
    // lançar o picker SÓ depois do sheet fechar (correção da tela preta no iOS).
    React.useImperativeHandle(ref, () => ({
      present: jest.fn(),
      dismiss: jest.fn(() => props.onDismiss?.()),
      expand: jest.fn(),
      collapse: jest.fn(),
      close: jest.fn(() => props.onDismiss?.()),
      snapToIndex: jest.fn(),
    }));
    return React.createElement(View, null, props.children);
  });
  return {
    __esModule: true,
    default: Passthrough,
    BottomSheetModal: Passthrough,
    BottomSheetModalProvider: ({ children }) => React.createElement(View, null, children),
    BottomSheetView: ({ children }) => React.createElement(View, null, children),
    BottomSheetBackdrop: () => React.createElement(View, null),
    BottomSheetScrollView: ({ children }) => React.createElement(View, null, children),
    // BottomSheetTextInput → TextInput nativo (mantém placeholder/onChangeText
    // para que os testes de sheets com motivo/observação dirijam o input).
    BottomSheetTextInput: React.forwardRef((props, ref) =>
      React.createElement(TextInput, { ...props, ref })
    ),
  };
});

// @shopify/flash-list — em jsdom o FlashList nem sempre mede e renderiza itens.
// Mapeamos data → renderItem dentro de uma View simples para que os itens
// apareçam na árvore de teste.
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  const toElement = (Comp) =>
    Comp == null
      ? null
      : React.isValidElement(Comp)
        ? Comp
        : React.createElement(Comp);
  const FlashList = ({
    data,
    renderItem,
    keyExtractor,
    ListEmptyComponent,
    ListFooterComponent,
    ListHeaderComponent,
  }) => {
    const items = data ?? [];
    const header = toElement(ListHeaderComponent);
    if (items.length === 0 && ListEmptyComponent) {
      const Empty = toElement(ListEmptyComponent);
      return React.createElement(View, null, header, Empty);
    }
    return React.createElement(
      View,
      null,
      header,
      items.map((item, index) => {
        const key = keyExtractor ? keyExtractor(item, index) : String(index);
        return React.createElement(React.Fragment, { key }, renderItem({ item, index }));
      }),
      toElement(ListFooterComponent)
    );
  };
  return { __esModule: true, FlashList };
});
