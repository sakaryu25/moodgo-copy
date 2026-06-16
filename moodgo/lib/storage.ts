import AsyncStorage from "@react-native-async-storage/async-storage";

export const FAVORITES_KEY = "moodgo-favorites";
export const HISTORY_KEY = "moodgo-history";
export const FEEDBACK_KEY = "moodgo-feedback";
export const PENDING_VISITED_KEY = "moodgo-pending-visited";
export const BLOCKED_PLACES_KEY = "moodgo-blocked-places";
export const BLOCKED_USERS_KEY = "moodgo-blocked-users";   // ブロックした投稿者のdevice_id一覧
export const PROFILE_KEY = "moodgo-profile";
export const CONSENT_KEY = "moodgo-consent-v1";   // 初回起動の利用規約同意フラグ
export const ONBOARDED_KEY = "moodgo-onboarded-v1";   // 初回オンボーディング＋プロフィール設定を一度通過したか（スキップ含む）

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {}
  return fallback;
}

export async function saveJSON(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
