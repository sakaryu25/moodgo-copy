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
let hashPromise: Promise<string> | null = null;

// 自分の公開ハッシュ(device_hash)。1回だけ取得しモジュールキャッシュ。
export async function getMyHash(): Promise<string> {
  if (cachedHash != null) return cachedHash;
  if (!hashPromise) {
    hashPromise = (async () => {
      try {
        const deviceId = await getDeviceId();
        const d = await apiFetch('/api/user-follows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'me', deviceId }),
        }).then((r) => r.json());
        cachedHash = typeof d?.hash === 'string' ? d.hash : '';
      } catch { cachedHash = ''; }
      return cachedHash as string;
    })();
  }
  return hashPromise;
}

export type MyIdentity = { hash: string; name: string; icon: string; handle: string; accountType: string };

// 自分の現在プロフィール（ストア）＋公開ハッシュ。設定を編集すると即座に更新される。
export function useMyIdentity(): MyIdentity {
  const s = useSettings();
  const [hash, setHash] = useState<string>(cachedHash ?? '');
  useEffect(() => {
    let alive = true;
    if (!cachedHash) getMyHash().then((h) => { if (alive) setHash(h); });
    return () => { alive = false; };
  }, []);
  return { hash: hash || cachedHash || '', name: s.nickname.trim(), icon: s.iconUrl, handle: s.handle, accountType: s.accountType };
}

export type PosterFields = { name?: string | null; icon?: string | null; handle?: string | null; accountType?: string | null };
export type ResolvedPoster = { name: string | null; icon: string | null; handle: string | null; accountType: string | null; isMe: boolean };

// posterId(公開ハッシュ)が自分なら現在の自分のプロフィールで上書き（未設定項目はサーバー値へフォールバック）。
export function resolvePoster(posterId: string | null | undefined, server: PosterFields, me: MyIdentity): ResolvedPoster {
  const isMe = !!posterId && !!me.hash && posterId === me.hash;
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
