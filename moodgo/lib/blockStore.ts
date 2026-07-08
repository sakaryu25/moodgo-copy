// ── blockStore ───────────────────────────────────────────────────────────────
// ブロック / ミュートの共有状態。ローカル(AsyncStorage)で即時に効かせつつ、サーバー
// (/api/user-block)で端末間同期＋コメントのサーバー側除外まで効かせる。
//   block も mute も「自分の画面から相手を隠す」点は同じなので、フィード/コメントの
//   除外対象は hidden = blocked ∪ muted。違いは block=相互フォロー解除して強く遮断、
//   mute=相手に気づかれず静かに非表示。
//   公開ID(poster_id = deviceHash)だけで扱い、生 device_id は一切保持しない。
//   永続キー: blocked=既存 BLOCKED_USERS_KEY（後方互換）/ muted=MUTED_USERS_KEY。
import { useSyncExternalStore } from 'react';
import { loadJSON, saveJSON, BLOCKED_USERS_KEY } from '@/lib/storage';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

const MUTED_USERS_KEY = 'moodgo-muted-users';

type State = { hydrated: boolean; blocked: string[]; muted: string[]; hidden: string[] };
let state: State = { hydrated: false, blocked: [], muted: [], hidden: [] };

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function setState(patch: Partial<State>) {
  const next = { ...state, ...patch };
  // hidden は setState 時に1回だけ新参照を作る（購読側 useMemo の依存を毎render壊さない）
  next.hidden = [...next.blocked, ...next.muted];
  state = next;
  emit();
}
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot() { return state; }

async function pushServer(action: 'block' | 'mute' | 'unblock', targetId: string): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    if (!deviceId) return;
    await apiFetch('/api/user-block', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, deviceId, targetId }),
    });
  } catch { /* オフラインでもローカルは効く。次回 hydrate で回収 */ }
}

let hydrating = false;
export async function hydrateBlocks(): Promise<void> {
  if (hydrating) return;
  hydrating = true;
  try {
    // 1) ローカルを即反映（オフラインでも過去のブロックが効く）
    const [localBlocked, localMuted] = await Promise.all([
      loadJSON<string[]>(BLOCKED_USERS_KEY, []),
      loadJSON<string[]>(MUTED_USERS_KEY, []),
    ]);
    const lb = Array.isArray(localBlocked) ? localBlocked : [];
    const lm = Array.isArray(localMuted) ? localMuted : [];
    setState({ hydrated: true, blocked: lb, muted: lm });

    // 2) サーバーと突き合わせ（端末間同期）。union で安全側（誤って解除しない）に寄せ、
    //    ローカルにしか無い分はサーバーへ反映（オフライン中の操作を回収）。
    const deviceId = await getDeviceId().catch(() => '');
    if (!deviceId) return;
    const res = await apiFetch('/api/user-block', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', deviceId }),
    });
    const d = await res.json();
    if (!d?.ok) return;
    const sb: string[] = Array.isArray(d.blocked) ? d.blocked : [];
    const sm: string[] = Array.isArray(d.muted) ? d.muted : [];
    const blocked = Array.from(new Set([...sb, ...lb]));
    const muted = Array.from(new Set([...sm, ...lm])).filter((h) => !blocked.includes(h));
    setState({ blocked, muted });
    saveJSON(BLOCKED_USERS_KEY, blocked);
    saveJSON(MUTED_USERS_KEY, muted);
    for (const h of lb) if (!sb.includes(h)) pushServer('block', h);
    for (const h of lm) if (!sm.includes(h) && !sb.includes(h)) pushServer('mute', h);
  } catch { /* サーバー未適用/失敗はローカルのみで動作 */ }
  finally { hydrating = false; }
}

// ── アクション（公開ID = poster_id を渡す）───────────────────────────────────────
export function blockUser(posterId: string): void {
  if (!posterId) return;
  const blocked = state.blocked.includes(posterId) ? state.blocked : [...state.blocked, posterId];
  const muted = state.muted.filter((h) => h !== posterId);
  setState({ blocked, muted });
  saveJSON(BLOCKED_USERS_KEY, blocked);
  saveJSON(MUTED_USERS_KEY, muted);
  pushServer('block', posterId);
}
export function muteUser(posterId: string): void {
  if (!posterId || state.blocked.includes(posterId)) return;   // ブロック済みは強い方を維持
  const muted = state.muted.includes(posterId) ? state.muted : [...state.muted, posterId];
  setState({ muted });
  saveJSON(MUTED_USERS_KEY, muted);
  pushServer('mute', posterId);
}
export function unblockUser(posterId: string): void {
  if (!posterId) return;
  const blocked = state.blocked.filter((h) => h !== posterId);
  const muted = state.muted.filter((h) => h !== posterId);
  setState({ blocked, muted });
  saveJSON(BLOCKED_USERS_KEY, blocked);
  saveJSON(MUTED_USERS_KEY, muted);
  pushServer('unblock', posterId);
}

/** React外からも使える即時判定 */
export function isHidden(posterId?: string | null): boolean {
  return !!posterId && (state.blocked.includes(posterId) || state.muted.includes(posterId));
}

// ── フック ────────────────────────────────────────────────────────────────────
export function useBlocks(): State {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// 初回 import 時に一度だけ自動ハイドレート（_layout 変更不要・render副作用を避ける）
void hydrateBlocks();
