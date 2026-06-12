// ── グループへのスポット共有ヘルパー ─────────────────────────────────────────
// 検索結果のスポットを、所属している仲良しグループのチャットに送る。
// グループが複数ある場合はアラートで選択（Alertのボタン数を考慮して最大4つ）。
import { Alert } from 'react-native';
import { apiFetch } from './api';
import { getDeviceId } from './abtest';

export type ShareableSpot = {
  title: string;
  address?: string;
  mapUrl?: string;
};

async function postToGroup(groupId: string, deviceId: string, spot: ShareableSpot): Promise<boolean> {
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

/** スポットをグループに共有する（グループ選択込みのフロー一式） */
export async function shareSpotToGroup(spot: ShareableSpot): Promise<void> {
  const deviceId = await getDeviceId();

  let groups: { id: string; name: string }[] = [];
  try {
    const res = await apiFetch(`/api/mood-groups?deviceId=${encodeURIComponent(deviceId)}`);
    const data = await res.json();
    if (data.ok) groups = data.groups;
  } catch { /* fallthrough */ }

  if (groups.length === 0) {
    Alert.alert(
      'グループがないよ',
      '下の💬タブからグループを作るか、招待コードで参加してね',
    );
    return;
  }

  const send = async (g: { id: string; name: string }) => {
    const ok = await postToGroup(g.id, deviceId, spot);
    Alert.alert(ok ? '共有したよ🎉' : 'エラー', ok
      ? `「${g.name}」に「${spot.title}」を送りました`
      : '共有に失敗しました。通信環境を確認してね');
  };

  if (groups.length === 1) {
    const g = groups[0];
    Alert.alert('グループに共有', `「${g.name}」に「${spot.title}」を送る？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '送る', onPress: () => send(g) },
    ]);
    return;
  }

  // 複数グループ → 選択（最大4つ＋キャンセル）
  Alert.alert('どのグループに共有する？', spot.title, [
    ...groups.slice(0, 4).map(g => ({ text: g.name, onPress: () => send(g) })),
    { text: 'キャンセル', style: 'cancel' as const },
  ]);
}
