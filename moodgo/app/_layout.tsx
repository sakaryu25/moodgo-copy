import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import GroupShareSheet from '@/components/GroupShareSheet';
import SplashScreen from '@/components/SplashScreen';
import ErrorBoundary from '@/components/ErrorBoundary';
import OfflineBanner from '@/components/OfflineBanner';
import ConsentGate from '@/components/ConsentGate';
import CopyToast from '@/components/CopyToast';
import { setupGlobalErrorHandlers } from '@/lib/crashReporting';
import { initSentry } from '@/lib/sentry';

// 起動時に一度だけ：グローバルなJSエラー捕捉＋（DSNがあれば）Sentry初期化
setupGlobalErrorHandlers();
initSentry();

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  if (!ready) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ErrorBoundary>
            <SplashScreen onFinish={() => setReady(true)} />
          </ErrorBoundary>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <Stack screenOptions={{ headerShown: false }} />
          {/* LINE風「送信先を選択」シート（shareSpotToGroupから全画面で呼べる） */}
          <GroupShareSheet />
          {/* オフライン時のバナー（全画面に重ねる） */}
          <OfflineBanner />
          {/* 初回起動の利用規約同意ゲート（最前面） */}
          <ConsentGate />
          {/* コピー等のトースト通知（全画面の最前面・自動消去） */}
          <CopyToast />
          <StatusBar style="auto" />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
