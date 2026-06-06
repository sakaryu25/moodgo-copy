import { Linking, Platform } from 'react-native';

/**
 * Google マップ「アプリ」で開く（Safari を介さない）。
 * 1) comgooglemaps:// スキームでGoogle Mapsアプリを直接起動
 * 2) アプリが無い/失敗 → 地図URL（端末既定）にフォールバック
 *
 * 注意: canOpenURL は LSApplicationQueriesSchemes 登録が必要で Expo Go では
 *       false を返すことがあるため、openURL を直接試して失敗時にフォールバックする。
 */
export async function openInGoogleMaps(opts: {
  query: string;
  lat?: number;
  lng?: number;
  mapsUri?: string;
}): Promise<void> {
  const hasCoord = typeof opts.lat === 'number' && typeof opts.lng === 'number';
  // 座標があれば座標を優先（名前検索だと別の同名スポットに飛ぶため、住所＝座標にピンを立てる）
  const qRaw = hasCoord ? `${opts.lat},${opts.lng}` : opts.query.trim();
  const q = encodeURIComponent(qRaw);

  // Google Maps アプリ用スキーム
  const appUrl = hasCoord
    ? `comgooglemaps://?q=${q}&center=${opts.lat},${opts.lng}&zoom=16`
    : `comgooglemaps://?q=${q}`;

  // フォールバック（アプリ未インストール時）。座標があれば座標、無ければ mapsUri/名前。
  const webUrl = hasCoord
    ? `https://www.google.com/maps/search/?api=1&query=${q}`
    : (opts.mapsUri || `https://www.google.com/maps/search/?api=1&query=${q}`);

  // Android は geo: でも Google Maps が開きやすいが、まず comgooglemaps を試す
  try {
    await Linking.openURL(appUrl);
    return;
  } catch {
    // fallthrough
  }

  if (Platform.OS === 'android') {
    try {
      await Linking.openURL(hasCoord ? `geo:${opts.lat},${opts.lng}?q=${q}` : `geo:0,0?q=${q}`);
      return;
    } catch {
      // fallthrough
    }
  }

  Linking.openURL(webUrl).catch(() => {});
}
