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
// 本人プロフィール（名前/アイコン/@ID）。従来 profile.tsx / SettingsView が使うキーと同一値。
const NICKNAME_KEY = "moodgo-group-nickname";
const USER_ICON_KEY = "moodgo-user-icon";
const HANDLE_KEY = "moodgo-user-handle";

export type Lang = "ja" | "en";

export type SettingsState = {
  hydrated: boolean;              // AsyncStorage からの初期読み込みが済んだか
  lang: Lang;
  profileAge: string;
  profileGender: string;
  profilePrefecture: string;
  profileBio: string;             // 一言メッセージ（自分の投稿ページに表示）
  showPrefecture: boolean;        // 在住地（都道府県）を表示するか
  nickname: string;               // 表示名（未設定は空→UI側で'MoodGo'にフォールバック）
  iconUrl: string;                // プロフィールアイコンURL（未設定は空）
  handle: string;                 // @ユーザーID（未設定は空）
  accountType: string;            // 'official' | 'store' | 'user' | ''（バッジ用・サーバー由来）
  blockedPlaces: string[];
};

let state: SettingsState = {
  hydrated: false,
  lang: "ja",
  profileAge: "",
  profileGender: "",
  profilePrefecture: "",
  profileBio: "",
  showPrefecture: true,
  nickname: "",
  iconUrl: "",
  handle: "",
  accountType: "",
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
    const [langRaw, profileRaw, blockedRaw, nickRaw, iconRaw, handleRaw] = await Promise.all([
      AsyncStorage.getItem(LANG_KEY),
      AsyncStorage.getItem(PROFILE_KEY),
      AsyncStorage.getItem(BLOCKED_PLACES_KEY),
      AsyncStorage.getItem(NICKNAME_KEY),
      AsyncStorage.getItem(USER_ICON_KEY),
      AsyncStorage.getItem(HANDLE_KEY),
    ]);
    let profile: { age?: string; gender?: string; prefecture?: string; bio?: string; showPrefecture?: boolean } = {};
    try { if (profileRaw) profile = JSON.parse(profileRaw); } catch { /* 破損時は空 */ }
    let blocked: string[] = [];
    try { if (blockedRaw) blocked = JSON.parse(blockedRaw); } catch { /* 破損時は空 */ }
    setState({
      hydrated: true,
      lang: langRaw === "en" ? "en" : "ja",
      profileAge: profile.age ?? "",
      profileGender: profile.gender ?? "",
      profilePrefecture: profile.prefecture ?? "",
      profileBio: profile.bio ?? "",
      showPrefecture: profile.showPrefecture !== false,   // 既定=表示
      nickname: nickRaw ?? "",
      iconUrl: iconRaw ?? "",
      handle: handleRaw ?? "",
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
  // bio/showPrefecture を消さないよう現在値をマージして永続化
  AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
    age, gender, prefecture, bio: state.profileBio, showPrefecture: state.showPrefecture,
  })).catch(() => {});
}

// 一言メッセージ＋在住地の表示有無（自分の投稿ページ用）
export function saveProfileExtras(bio: string, showPrefecture: boolean): void {
  setState({ profileBio: bio, showPrefecture });
  AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
    age: state.profileAge, gender: state.profileGender, prefecture: state.profilePrefecture,
    bio, showPrefecture,
  })).catch(() => {});
}

// ── 本人プロフィール（名前/アイコン/@ID/バッジ）: 変更を全画面へ即時反映 ─────────
export function saveNickname(name: string): void {
  setState({ nickname: name });
  AsyncStorage.setItem(NICKNAME_KEY, name).catch(() => {});
}
export function saveIconUrl(url: string): void {
  setState({ iconUrl: url });
  AsyncStorage.setItem(USER_ICON_KEY, url).catch(() => {});
}
export function saveHandle(handle: string): void {
  setState({ handle });
  AsyncStorage.setItem(HANDLE_KEY, handle).catch(() => {});
}
// account_type はサーバー(user_handles)由来。永続はせず、取得できたらバッジ即時表示のため保持。
export function setAccountType(accountType: string): void {
  if (state.accountType === accountType) return;
  setState({ accountType });
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
