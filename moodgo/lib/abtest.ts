import AsyncStorage from "@react-native-async-storage/async-storage";

// G-2: 簡易A/Bテスト基盤
// デバイス単位で安定した variant（"A" or "B"）を割り当てる。
// 一度割り当てた variant は AsyncStorage に保存して以後変わらないようにする。

const AB_VARIANT_KEY = "moodgo-ab-variant";
const AB_DEVICE_ID_KEY = "moodgo-device-id";

let _cachedVariant: "A" | "B" | null = null;

/** デバイス固有IDを取得（無ければ生成して保存）。閉店報告の重複防止(sessionId)にも使う。 */
export async function getDeviceId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(AB_DEVICE_ID_KEY);
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem(AB_DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

/** 文字列から安定したハッシュ値を生成（FNV-1a） */
function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** このデバイスの A/B variant を取得（50/50 振り分け、安定） */
export async function getABVariant(): Promise<"A" | "B"> {
  if (_cachedVariant) return _cachedVariant;
  try {
    const saved = await AsyncStorage.getItem(AB_VARIANT_KEY);
    if (saved === "A" || saved === "B") {
      _cachedVariant = saved;
      return saved;
    }
    const deviceId = await getDeviceId();
    const variant: "A" | "B" = hashStr(deviceId) % 2 === 0 ? "A" : "B";
    await AsyncStorage.setItem(AB_VARIANT_KEY, variant);
    _cachedVariant = variant;
    return variant;
  } catch {
    return "A";
  }
}
