import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Alert } from 'react-native';

// 場所名を長押しでコピー（結果カード・履歴・お気に入り・詳細で共通利用）
export async function copyPlaceName(name?: string | null) {
  const text = (name ?? '').trim();
  if (!text) return;
  try {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert('コピーしました', `「${text}」`);
  } catch {
    /* コピー失敗は無視 */
  }
}
