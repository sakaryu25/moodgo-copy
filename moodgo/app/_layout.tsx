import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState } from 'react';
import GroupShareSheet from '@/components/GroupShareSheet';
import SplashScreen from '@/components/SplashScreen';
import ErrorBoundary from '@/components/ErrorBoundary';
import OfflineBanner from '@/components/OfflineBanner';
import ConsentGate from '@/components/ConsentGate';
import CopyToast from '@/components/CopyToast';
import { setupGlobalErrorHandlers } from '@/lib/crashReporting';
import { initSentry } from '@/lib/sentry';
// プッシュ通知の権限要求は起動時に行わない（審査対策）。opt-in導線から @/lib/push を呼ぶ（下記コメント参照）。

// 起動時に一度だけ：グローバルなJSエラー捕捉＋（DSNがあれば）Sentry初期化
setupGlobalErrorHandlers();
initSentry();

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // プッシュ通知トークンの登録は「起動直後の無文脈な権限ダイアログ」を避けるため起動時には行わない
  //   （App Store審査 4.5.4 / 5.1.1 対策＋UX）。registerForPushNotificationsAsync()（@/lib/push）は
  //   明示的なopt-in導線＝通知一覧を開いた時(notifications.tsx)・フォロー成功時(user/[id]・follow-list)・
  //   投稿成功時(post.tsx) から呼ばれる（2026-07-11配線）。ここには追加しないこと。

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
          {/* fullScreenGestureEnabled: 画面のどこからでも右スワイプで前のページへ
              （iOS標準のエッジのみ→全面に拡張。横スクロールUIはそちらが優先されるので競合しない） */}
          <Stack screenOptions={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: true }} />
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
