// ── useTabReset ──────────────────────────────────────────────────────────────
// 下部ネイティブタブを「再タップ」した時だけ onReset を呼ぶ（他タブから切り替えた時は呼ばない）。
//   #14: 各ページで下部バーを押したら振り出しに戻す（特集=日本地図に戻るのと同じ挙動を全タブへ）。
//   NativeTabs(expo-router/unstable-native-tabs) は @react-navigation ベースなので tabPress を購読し、
//   isFocused() で「既にそのタブが前面＝再タップ」だけを判定する。型に tabPress/isFocused が無いため cast。
import { useEffect, useRef } from 'react';
import { useNavigation } from 'expo-router';

export function useTabReset(onReset: () => void) {
  const navigation = useNavigation();
  const cb = useRef(onReset);
  cb.current = onReset;
  useEffect(() => {
    const nav = navigation as unknown as {
      addListener?: (e: string, listener: () => void) => (() => void) | undefined;
      isFocused?: () => boolean;
    };
    const unsub = nav.addListener?.('tabPress', () => {
      if (nav.isFocused?.()) cb.current();
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [navigation]);
}
