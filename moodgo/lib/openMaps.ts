import { Linking, Platform } from 'react-native';

/**
 * Google マップ「アプリ」で開く（Safari を介さない）。
 * 1) comgooglemaps:// スキームでGoogle Mapsアプリを直接起動
 * 2) アプリが無い/失敗 → 地図URL（端末既定）にフォールバック
 *
 * クエリの方針（2026-07-14変更）:
 *   旧: 座標があれば座標で検索＝位置は正確だが「ただのピン」で店舗情報(営業時間/口コミ)が見えない。
 *   新: 名前＋住所(query)で検索＝Googleの店舗リスティングに着地して情報が見える。
 *       座標は appスキームの center ヒントに使い（同名別店への誤着地防止）、
 *       query が空の時だけ座標ピンにフォールバック。
 *       mapsUri（Googleの正しい店ページURL）があれば web フォールバックで最優先。
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
  const qText = opts.query.trim();
  // 名前/住所があればそれで検索（店舗情報が見える）。無い時だけ座標ピン。
  const qRaw = qText || (hasCoord ? `${opts.lat},${opts.lng}` : '');
  if (!qRaw) return;
  const q = encodeURIComponent(qRaw);

  // Google Maps アプリ用スキーム。座標は center ヒントとして添える＝
  // 「名前検索だと別の同名スポットに飛ぶ」問題を近傍優先で防ぎつつ店ページに着地する。
  const appUrl = hasCoord
    ? `comgooglemaps://?q=${q}&center=${opts.lat},${opts.lng}&zoom=16`
    : `comgooglemaps://?q=${q}`;

  // フォールバック（アプリ未インストール時）。Googleの正しい店ページURL(mapsUri)が最優先。
  const webUrl = opts.mapsUri || `https://www.google.com/maps/search/?api=1&query=${q}`;

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
