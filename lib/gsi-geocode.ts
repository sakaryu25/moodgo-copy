// ─── GSI(国土地理院) AddressSearch の結果選択（2026-07-07 致命バグ修正）───────────
// GSI は結果を有名度順に返さない: 「渋谷」の先頭は福島県猪苗代町渋谷・「東京」は札幌市東区・
// 「横浜」は青森県横浜町・「新宿」は山形県朝日町新宿（本番実測）。[0] を採ると全国の主要地名が
// 誤座標になり、手入力エリア検索が全気分で壊れる。
//
// 選択規則:
//   ① title がクエリと完全一致
//   ② title が「クエリ+行政接尾辞(区→市→都道府県→町村)」で終わる
//      例: 渋谷 →「東京都渋谷区」(渋谷+区で終わる) が福島県猪苗代町渋谷より優先される
//   ③ クエリ自体が都道府県名で始まる完全住所なら [0]（GSIが既に正しくスコープ済み）
//   どれにも該当しなければ null → 呼び出し側は Google Geocoding(有名度順) へフォールバック
export type GsiFeature = {
  properties?: { title?: string };
  geometry?: { coordinates?: number[] };  // [lng, lat]
};

export function pickGsiResult(arr: GsiFeature[] | null | undefined, q: string): GsiFeature | null {
  if (!Array.isArray(arr) || arr.length === 0 || !q) return null;
  const coordsOk = (r: GsiFeature | undefined) => Array.isArray(r?.geometry?.coordinates) && typeof r!.geometry!.coordinates![1] === "number";
  // ① 完全一致
  const exact = arr.find((r) => (r?.properties?.title ?? "") === q);
  if (coordsOk(exact)) return exact!;
  // ② 行政区画一致（区 > 市 > 都道府県 > 町村 の順で優先）
  for (const suf of ["区", "市", "都", "道", "府", "県", "町", "村"]) {
    const hit = arr.find((r) => (r?.properties?.title ?? "").endsWith(q + suf));
    if (coordsOk(hit)) return hit!;
  }
  // ③ 都道府県名で始まる完全住所（例: 東京都渋谷区宇田川町5）は先頭を信用
  if (/^(東京都|北海道|大阪府|京都府|.{2,3}県)/.test(q)) {
    if (coordsOk(arr[0])) return arr[0];
  }
  return null;
}
