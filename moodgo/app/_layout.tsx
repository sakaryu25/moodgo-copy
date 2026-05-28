import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState } from 'react';
import SplashScreen from '@/components/SplashScreen';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <SplashScreen onFinish={() => setReady(true)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
