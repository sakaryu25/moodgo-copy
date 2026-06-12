// ── グループへのスポット共有ヘルパー ─────────────────────────────────────────
// 検索結果・いいね・履歴のスポットを、所属している仲良しグループのチャットに送る。
// 通常は GroupShareSheet（LINE風の送信先選択シート）が表示され、複数グループへ転送できる。
// シート未マウント時のみ旧Alertフローにフォールバック。
import { Alert } from 'react-native';
import { apiFetch } from './api';
import { getDeviceId } from './abtest';

export type ShareableSpot = {
  title: string;
  address?: string;
  mapUrl?: string;
};

export type ShareTargetGroup = {
  id: string;
  name: string;
  icon?: string | null;     // アイコン写真の公開URL
  member_count?: number;
};

export async function postSpotToGroup(groupId: string, deviceId: string, spot: ShareableSpot): Promise<boolean> {
  try {
    const res = await apiFetch('/api/mood-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'post',
        groupId,
        deviceId,
        spotName: spot.title,
        spotAddress: spot.address ?? '',
        spotUrl: spot.mapUrl ?? '',
      }),
    });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}

export async function fetchMyGroups(deviceId: string): Promise<ShareTargetGroup[]> {
  try {
    const res = await apiFetch(`/api/mood-groups?deviceId=${encodeURIComponent(deviceId)}`);
    const data = await res.json();
    if (data.ok) return data.groups;
  } catch { /* fallthrough */ }
  return [];
}

// ── 送信先選択シート（GroupShareSheet）との橋渡し ──
// _layout.tsx にマウントされたシートが presenter を登録し、
// shareSpotToGroup はそれを呼ぶだけ（UI表示・転送はシート側が担当）。
type Presenter = (spot: ShareableSpot) => void;
let presenter: Presenter | null = null;
export function registerGroupSharePresenter(fn: Presenter | null) {
  presenter = fn;
}

/** スポットをグループに共有する（LINE風の送信先選択シートを表示） */
export async function shareSpotToGroup(spot: ShareableSpot): Promise<void> {
  if (presenter) {
    presenter(spot);
    return;
  }

  // フォールバック（シート未マウント時）: 旧Alertフロー
  const deviceId = await getDeviceId();
  const groups = await fetchMyGroups(deviceId);

  if (groups.length === 0) {
    Alert.alert(
      'グループがないよ',
      '下の💬タブからグループを作るか、招待コードで参加してね',
    );
    return;
  }

  const send = async (g: ShareTargetGroup) => {
    const ok = await postSpotToGroup(g.id, deviceId, spot);
    Alert.alert(ok ? '共有したよ🎉' : 'エラー', ok
      ? `「${g.name}」に「${spot.title}」を送りました`
      : '共有に失敗しました。通信環境を確認してね');
  };

  Alert.alert('どのグループに共有する？', spot.title, [
    ...groups.slice(0, 4).map(g => ({ text: g.name, onPress: () => send(g) })),
    { text: 'キャンセル', style: 'cancel' as const },
  ]);
}
