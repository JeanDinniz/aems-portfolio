// getSentryExpoConfig é um drop-in do getDefaultConfig do Expo que adiciona o
// serializer de source maps do Sentry (HARD-02). Só afeta o bundler (dev/build),
// não o Jest. Upload real dos source maps só ocorre no build EAS quando o
// sentry-cli tem SENTRY_AUTH_TOKEN (EAS secret); sem token, apenas gera os maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');

const config = getSentryExpoConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
