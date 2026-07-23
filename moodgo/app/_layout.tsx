import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState } from 'react';
import GroupShareSheet from '@/components/GroupShareSheet';
import ResultsPortalOutlet from '@/components/ResultsPortalOutlet';
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
          {/* 右スワイプで前のページへ戻る（ほぼ全Stackページ共通）。
              fullScreenGestureEnabled=true＝画面のどこからでも右へスワイプすれば1つ前へ戻れる（ユーザー要望2026-07-22）。
              ただし写真を横スワイプするカルーセル系の詳細ページは、横スクロールとの誤爆を防ぐため
              下で個別に fullScreenGestureEnabled:false（左端エッジのみ）へ固定する。
              ※place は自前の <Stack.Screen>（animation:'none'）でエッジ固定済みなのでここには列挙しない。 */}
          <Stack screenOptions={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: true }}>
            {/* 根の(tabs)＝ホーム等のタブ画面は「戻る先」が無い。ここでスワイプ戻ると GO_BACK が
                どのnavigatorにも処理されず警告になるため、タブ根はスワイプ戻る自体を無効化する。 */}
            <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
            <Stack.Screen name="community-spot" options={{ fullScreenGestureEnabled: false }} />
            <Stack.Screen name="feature-spot" options={{ fullScreenGestureEnabled: false }} />
            <Stack.Screen name="books/[bookId]" options={{ fullScreenGestureEnabled: false }} />
            <Stack.Screen name="feature/spot/[id]" options={{ fullScreenGestureEnabled: false }} />
          </Stack>
          {/* 検索クイズ/結果のルート直下オーバーレイ（旧・全画面Modalの置換）。Stackの上に重ね、
              /place遷移中は自身がopacity0で退避＝裏の/placeが即前面化しホームのチラつきが出ない。 */}
          <ResultsPortalOutlet />
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
