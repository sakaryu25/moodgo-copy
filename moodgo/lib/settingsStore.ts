// ── settingsStore ─────────────────────────────────────────────────────────────
// 設定まわりの共有状態（言語・プロフィール・非表示スポット）をモジュールレベルで持ち、
// ホーム(index)とプロフィールタブ(profile)の両方から同じ真実を read/write できるようにする。
// これまで index.tsx に集中していた設定 state を、設定UIをプロフィールタブへ移すために持ち上げた。
// useSyncExternalStore で購読するので、片方の画面で変更すると両方に即反映される。
//
// 永続化キー: 言語=moodgo-lang / プロフィール=PROFILE_KEY / 非表示=BLOCKED_PLACES_KEY
//   （プロフィール・非表示は従来 index.tsx が使っていたキーと同一なので後方互換）

import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PROFILE_KEY, BLOCKED_PLACES_KEY } from "./storage";

const LANG_KEY = "moodgo-lang";

export type Lang = "ja" | "en";

export type SettingsState = {
  hydrated: boolean;              // AsyncStorage からの初期読み込みが済んだか
  lang: Lang;
  profileAge: string;
  profileGender: string;
  profilePrefecture: string;
  blockedPlaces: string[];
};

let state: SettingsState = {
  hydrated: false,
  lang: "ja",
  profileAge: "",
  profileGender: "",
  profilePrefecture: "",
  blockedPlaces: [],
};

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function setState(patch: Partial<SettingsState>) {
  state = { ...state, ...patch };
  emit();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function getSnapshot(): SettingsState { return state; }

// ── 初期ハイドレート（アプリ起動時に一度）──────────────────────────────────────
let hydrating = false;
export async function hydrateSettings(): Promise<void> {
  if (state.hydrated || hydrating) return;
  hydrating = true;
  try {
    const [langRaw, profileRaw, blockedRaw] = await Promise.all([
      AsyncStorage.getItem(LANG_KEY),
      AsyncStorage.getItem(PROFILE_KEY),
      AsyncStorage.getItem(BLOCKED_PLACES_KEY),
    ]);
    let profile: { age?: string; gender?: string; prefecture?: string } = {};
    try { if (profileRaw) profile = JSON.parse(profileRaw); } catch { /* 破損時は空 */ }
    let blocked: string[] = [];
    try { if (blockedRaw) blocked = JSON.parse(blockedRaw); } catch { /* 破損時は空 */ }
    setState({
      hydrated: true,
      lang: langRaw === "en" ? "en" : "ja",
      profileAge: profile.age ?? "",
      profileGender: profile.gender ?? "",
      profilePrefecture: profile.prefecture ?? "",
      blockedPlaces: Array.isArray(blocked) ? blocked : [],
    });
  } catch {
    setState({ hydrated: true });
  } finally {
    hydrating = false;
  }
}

// ── アクション ────────────────────────────────────────────────────────────────
export function setLang(lang: Lang): void {
  setState({ lang });
  AsyncStorage.setItem(LANG_KEY, lang).catch(() => {});
}

export function saveProfile(age: string, gender: string, prefecture: string): void {
  setState({ profileAge: age, profileGender: gender, profilePrefecture: prefecture });
  AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ age, gender, prefecture })).catch(() => {});
}

function persistBlocked(next: string[]): void {
  AsyncStorage.setItem(BLOCKED_PLACES_KEY, JSON.stringify(next)).catch(() => {});
}
export function addBlockedPlace(title: string): void {
  if (!title || state.blockedPlaces.includes(title)) return;
  const next = [...state.blockedPlaces, title];
  setState({ blockedPlaces: next });
  persistBlocked(next);
}
export function unblockPlace(title: string): void {
  const next = state.blockedPlaces.filter((t) => t !== title);
  setState({ blockedPlaces: next });
  persistBlocked(next);
}
export function clearBlocked(): void {
  setState({ blockedPlaces: [] });
  persistBlocked([]);
}

// ── フック ────────────────────────────────────────────────────────────────────
export function useSettings(): SettingsState {
  return useSyncExternalStore(subscribe, getSnapshot);
}
