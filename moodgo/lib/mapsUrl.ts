// マップボタン用URL生成。
//   目的: 「座標ピンだけ」でなく、その店の Google マップ検索結果(=店ページ)に着地させる。
//   ・google_place_id(ChIJ...)がある店 → query_place_id で正確なページを開く
//   ・place_id が無い店(OSM在庫が大半) → 店名＋住所で検索(座標でなく名前検索なので店に着地しやすい)
//   ・universal link(https://www.google.com/maps/...)なので、Googleマップアプリがあればアプリ、
//     無ければブラウザで開く（iOSの comgooglemaps:// スキーム判定＋座標フォールバックが不要になる）。
export function buildGoogleMapsUrl(
  name?: string | null,
  address?: string | null,
  placeId?: string | null,
): string {
  const nm = (name ?? '').trim();
  const pid = (placeId ?? '').trim();
  const isGooglePlaceId = /^ChIJ/.test(pid);   // 本物のGoogle Place IDのみ(sb-合成idやsupabaseIdは除外)
  if (isGooglePlaceId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nm || 'map')}&query_place_id=${encodeURIComponent(pid)}`;
  }
  // place_id無し: 名前＋住所で検索（同名店の取り違え防止に住所を添える）
  const q = [nm, (address ?? '').trim()].filter(Boolean).join(' ') || nm || 'map';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
