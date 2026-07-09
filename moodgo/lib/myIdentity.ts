// ── myIdentity ────────────────────────────────────────────────────────────────
// 投稿のプロフィール（名前/アイコン/@ID/バッジ）は投稿作成時にフリーズ(denormalize)されるため、
// プロフィールを編集しても過去の投稿には反映されない。ログイン無しモデルでは公開ハッシュ
// (device_hash=poster_id)で「自分の投稿か」を判定できるので、自分の投稿だけは表示時に
// 「現在の自分のプロフィール」(settingsStore)で上書きし、全画面で表示を統一する。
import { useEffect, useState } from 'react';
import { useSettings } from './settingsStore';
import { apiFetch } from './api';
import { getDeviceId } from './abtest';

let cachedHash: string | null = null;
let cachedAnonHash: string | null = null;
let mePromise: Promise<{ hash: string; anonHash: string }> | null = null;

// 自分の公開ハッシュ(device_hash)＋匿名投稿用ハッシュ(anon_hash)。1回だけ取得しモジュールキャッシュ。
//   anonHash は匿名投稿(spot_public_anonymous)の poster_id と同じ別名前空間ハッシュ。
//   「自分の匿名投稿」を client 側で判定して自己表示するために使う（他人には逆引き不可のまま）。
async function fetchMe(): Promise<{ hash: string; anonHash: string }> {
  if (cachedHash != null && cachedAnonHash != null) return { hash: cachedHash, anonHash: cachedAnonHash };
  if (!mePromise) {
    mePromise = (async () => {
      try {
        const deviceId = await getDeviceId();
        const d = await apiFetch('/api/user-follows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'me', deviceId }),
        }).then((r) => r.json());
        cachedHash = typeof d?.hash === 'string' ? d.hash : '';
        cachedAnonHash = typeof d?.anonHash === 'string' ? d.anonHash : '';
      } catch { cachedHash = ''; cachedAnonHash = ''; }
      return { hash: cachedHash as string, anonHash: cachedAnonHash as string };
    })();
  }
  return mePromise;
}

// 自分の公開ハッシュ（既存API互換）。
export async function getMyHash(): Promise<string> {
  return (await fetchMe()).hash;
}

export type MyIdentity = { hash: string; anonHash: string; name: string; icon: string; handle: string; accountType: string };

// 自分の現在プロフィール（ストア）＋公開/匿名ハッシュ。設定を編集すると即座に更新される。
export function useMyIdentity(): MyIdentity {
  const s = useSettings();
  const [ids, setIds] = useState<{ hash: string; anonHash: string }>({ hash: cachedHash ?? '', anonHash: cachedAnonHash ?? '' });
  useEffect(() => {
    let alive = true;
    if (cachedHash == null || cachedAnonHash == null) fetchMe().then((m) => { if (alive) setIds(m); });
    return () => { alive = false; };
  }, []);
  return {
    hash: ids.hash || cachedHash || '',
    anonHash: ids.anonHash || cachedAnonHash || '',
    name: s.nickname.trim(), icon: s.iconUrl, handle: s.handle, accountType: s.accountType,
  };
}

export type PosterFields = { name?: string | null; icon?: string | null; handle?: string | null; accountType?: string | null };
export type ResolvedPoster = { name: string | null; icon: string | null; handle: string | null; accountType: string | null; isMe: boolean };

// posterId が自分なら現在の自分のプロフィールで上書き（未設定項目はサーバー値へフォールバック）。
//   公開投稿は me.hash、匿名投稿(spot_public_anonymous)は me.anonHash と一致する＝どちらも自分。
export function resolvePoster(posterId: string | null | undefined, server: PosterFields, me: MyIdentity): ResolvedPoster {
  const isMe = !!posterId && ((!!me.hash && posterId === me.hash) || (!!me.anonHash && posterId === me.anonHash));
  if (!isMe) {
    return { name: server.name ?? null, icon: server.icon ?? null, handle: server.handle ?? null, accountType: server.accountType ?? null, isMe: false };
  }
  return {
    name: me.name || (server.name ?? null),
    icon: me.icon || (server.icon ?? null),
    handle: me.handle || (server.handle ?? null),
    accountType: me.accountType || (server.accountType ?? null),
    isMe: true,
  };
}
