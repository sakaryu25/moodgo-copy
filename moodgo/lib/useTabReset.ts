// ── useTabReset ──────────────────────────────────────────────────────────────
// 下部ネイティブタブを「再タップ」した時だけ onReset を呼ぶ（他タブから切り替えた時は呼ばない）。
//   #14: 各ページで下部バーを押したら振り出しに戻す（特集=日本地図に戻る等を全タブへ）。
//
// ⚠ 検知方法の重要な経緯（2026-07-06 実機検証で判明）:
//   NativeTabs(expo-router/unstable-native-tabs)は 'tabPress' イベントを一切発行しない
//   （旧実装はtabPress購読だったため全タブで一度も発火していなかった）。
//   実際の再タップ経路は: UITabBar再選択 → ネイティブspecial effect(popToRoot/scrollToTop)が
//   未処理の場合のみ expo-router が JUMP_TO(同一タブ) を dispatch → 状態不変＝no-op。
//   react-navigation は no-op でも '__unsafe_action__' を必ず emit するため、
//   「type=JUMP_TO かつ noop かつ payload.name=自分のルート」を再タップとして検知する。
//   前提: (tabs)/_layout.tsx の各 Trigger に disablePopToTop / disableScrollToTop を
//   指定してネイティブ側で再選択を消費させないこと（外すとJSにイベントが届かない）。
//   tabPress購読は将来expo-routerが正式対応した時の保険として残す。
import { useEffect, useRef } from 'react';
import { useNavigationContainerRef } from 'expo-router';
import { useNavigation, useRoute } from '@react-navigation/native';

type UnsafeActionEvent = {
  data?: {
    action?: { type?: string; payload?: { name?: string } };
    noop?: boolean;
  };
};

export function useTabReset(onReset: () => void) {
  const rootRef = useNavigationContainerRef();
  const navigation = useNavigation();
  const route = useRoute();
  const cb = useRef(onReset);
  cb.current = onReset;
  useEffect(() => {
    const nav = navigation as unknown as {
      addListener?: (e: string, listener: () => void) => (() => void) | undefined;
      isFocused?: () => boolean;
    };
    const unsubPress = nav.addListener?.('tabPress', () => {
      if (nav.isFocused?.()) cb.current();
    });
    const root = rootRef as unknown as {
      addListener?: (e: string, listener: (e: UnsafeActionEvent) => void) => (() => void) | undefined;
    };
    const unsubAction = root.addListener?.('__unsafe_action__', (e) => {
      const action = e?.data?.action;
      if (action?.type !== 'JUMP_TO') return;
      if (action?.payload?.name !== route.name) return;   // 自分のタブ宛てのみ
      // 再タップ判定: __unsafe_action__ は状態更新「前」に発火するため、
      //   タブ切替なら宛先タブ(自分)はまだ focused=false、再タップなら focused=true。
      //   noopは使わない(再タップでも履歴更新で状態が変わり noop=false になる・実機検証済み)
      if (nav.isFocused?.() !== true) return;
      cb.current();
    });
    return () => {
      if (typeof unsubPress === 'function') unsubPress();
      if (typeof unsubAction === 'function') unsubAction();
    };
  }, [navigation, rootRef, route.name]);
}
