import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { showToast } from '@/lib/toast';

// 場所名を長押しでコピー（結果カード・履歴・お気に入り・詳細で共通利用）。
// OS標準Alertではなく、MoodGoらしい紫グラデの自動消去トーストで通知する。
export async function copyPlaceName(name?: string | null) {
  const text = (name ?? '').trim();
  if (!text) return;
  try {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    showToast('コピーしました', `「${text}」`);
  } catch {
    /* コピー失敗は無視 */
  }
}
