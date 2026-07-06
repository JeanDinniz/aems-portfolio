import { ActivityIndicator, Text, View } from 'react-native';

/** Tela de carregamento exibida enquanto o auth store é reidratado/bootstrapped. */
export function SplashScreen() {
    return (
        <View className="flex-1 items-center justify-center bg-brand-black">
            <Text className="mb-6 text-3xl font-extrabold tracking-wide text-brand">
                AEMS
            </Text>
            <ActivityIndicator color="#F5B800" />
        </View>
    );
}
