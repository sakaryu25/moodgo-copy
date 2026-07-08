import AsyncStorage from "@react-native-async-storage/async-storage";

// expo-secure-store は未ビルドのdev-client(ネイティブ未リンク)だと import 時点で
// 「Cannot find native module 'ExpoSecureStore'」を投げてアプリ全体を落とす。
// 動的requireで安全に読み込み、失敗時は null → AsyncStorage のみで従来どおり動作させる
// （＝再ビルド後に自動でKeychain端末ID永続化が有効化。未ビルドでもクラッシュしない）。
let SecureStore: typeof import("expo-secure-store") | null = null;
try { SecureStore = require("expo-secure-store"); } catch { SecureStore = null; }

// G-2: 簡易A/Bテスト基盤
// デバイス単位で安定した variant（"A" or "B"）を割り当てる。
// 一度割り当てた variant は AsyncStorage に保存して以後変わらないようにする。

const AB_VARIANT_KEY = "moodgo-ab-variant";
const AB_DEVICE_ID_KEY = "moodgo-device-id";

let _cachedVariant: "A" | "B" | null = null;

/** デバイス固有IDを取得（無ければ生成して保存）。閉店報告の重複防止(sessionId)にも使う。
 *  ⚠ deviceId はログイン無しモデルの「ベアラ資格情報」（漏れると本人として投稿削除・
 *  アカウント削除まで可能）。2026-07-05監査対応:
 *   - 新規生成のエントロピーを強化（旧: 時刻+8桁 ≈41bit → 新: 時刻+32桁 ≈165bit。
 *     API側の永続レート制限と合わせ総当たりを実質不可能に）
 *   - サーバーAPIは生deviceIdをレスポンス/公開URLに出さない（lib/device-hash.ts）
 *  既存端末のIDは変えない（変えると投稿・お気に入り等の本人紐付けが切れるため）。
 *
 *  2026-07-09: 再インストール耐性を追加。SecureStore(iOS Keychain)を最優先にし、端末を入れ直しても
 *  同一IDを引き継げるようにした（ブロック/フォロー/お気に入り等の本人紐付けが再インストールで消えない）。
 *   - 既存ユーザー: 旧AsyncStorageのIDをKeychainへ移行して保全（IDは変えない）。
 *   - ネイティブ未ビルド/非対応端末: SecureStore呼び出しがthrow→従来どおりAsyncStorageで安全に動作。
 *   - AsyncStorageにも常にミラー（フォールバック用）。 */
export async function getDeviceId(): Promise<string> {
  try {
    // 1) Keychain(SecureStore)優先。ネイティブ未ビルド時は throw → 下の経路へフォールバック。
    let secure: string | null = null;
    if (SecureStore) { try { secure = await SecureStore.getItemAsync(AB_DEVICE_ID_KEY); } catch { secure = null; } }
    if (secure) {
      AsyncStorage.setItem(AB_DEVICE_ID_KEY, secure).catch(() => {});   // ミラー保険
      return secure;
    }
    // 2) 旧AsyncStorageのIDを引き継ぐ（既存ユーザーの本人紐付けを保全してKeychainへ移行）
    const legacy = await AsyncStorage.getItem(AB_DEVICE_ID_KEY);
    if (legacy) {
      if (SecureStore) { try { await SecureStore.setItemAsync(AB_DEVICE_ID_KEY, legacy); } catch { /* 非対応端末はAsyncStorageのまま */ } }
      return legacy;
    }
    // 3) 新規発行（強エントロピー）→ Keychain(可能なら)＋AsyncStorage両方へ
    const rand = () => Math.random().toString(36).slice(2, 10);
    const fresh = `${Date.now()}-${rand()}${rand()}${rand()}${rand()}`;
    if (SecureStore) { try { await SecureStore.setItemAsync(AB_DEVICE_ID_KEY, fresh); } catch { /* 非対応端末はAsyncStorageのみ */ } }
    await AsyncStorage.setItem(AB_DEVICE_ID_KEY, fresh).catch(() => {});
    return fresh;
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
