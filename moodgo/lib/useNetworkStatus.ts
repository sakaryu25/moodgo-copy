// オフライン検知フック。expo-network には変化イベントが無いため、
// 起動時チェック＋数秒間隔のポーリングで判定する（軽量）。
import { useEffect, useRef, useState } from 'react';
import * as Network from 'expo-network';

export function useNetworkStatus(pollMs = 4000): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(true);  // 初期は楽観的にオンライン
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const check = async () => {
      try {
        const st = await Network.getNetworkStateAsync();
        // isInternetReachable が undefined の端末では isConnected を採用
        const online = (st.isInternetReachable ?? st.isConnected ?? true) === true;
        if (mounted.current) setIsOnline(online);
      } catch {
        // 取得失敗時はオフライン扱いにしない（誤検知を避ける）
        if (mounted.current) setIsOnline(true);
      }
    };
    check();
    const id = setInterval(check, pollMs);
    return () => { mounted.current = false; clearInterval(id); };
  }, [pollMs]);

  return { isOnline };
}
