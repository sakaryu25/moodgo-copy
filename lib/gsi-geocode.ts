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

// 47都道府県の名称（「福島」等はGSIに都道府県単体エントリが無く、大阪市福島区などの
// 同名区市に誤マッチするため、GSIをスキップしてGoogle(県庁所在地=有名度順)に任せる）
const PREF_NAMES = new Set([
  "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬",
  "埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野",
  "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
  "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡",
  "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
]);

export function pickGsiResult(arr: GsiFeature[] | null | undefined, q: string): GsiFeature | null {
  if (!Array.isArray(arr) || arr.length === 0 || !q) return null;
  // 都道府県名そのもの（「福島」「福島県」等）はGoogleへ（例外: 京都/大阪は市としても
  //   使われるが県庁所在地=市中心なのでGoogleでも同等の結果になる）
  const qBase = q.replace(/[都道府県]$/, "");
  if (PREF_NAMES.has(qBase) && q.length <= 4) return null;
  const coordsOk = (r: GsiFeature | undefined) => Array.isArray(r?.geometry?.coordinates) && typeof r!.geometry!.coordinates![1] === "number";
  const PREF_RE = /^(東京都|北海道|大阪府|京都府|.{2,3}県)/;
  // 行政区画一致。タイトルが都道府県名で始まる候補だけを信用する。
  //   ⚠ 完全一致は使わない: GSIには素タイトル「渋谷」(富山の小字)・「横浜」(高知)・「梅田町」等が
  //   混在し、完全一致や無条件endsWithはそれを拾って誤座標になる（本番実測で富山/高知に飛んだ）。
  //   順序: 県>都>道>府を先に（「福島」=県名の意図を大阪市福島区より優先）、次に区>市>町>村。
  for (const suf of ["県", "都", "道", "府", "区", "市", "町", "村"]) {
    const hit = arr.find((r) => {
      const t = r?.properties?.title ?? "";
      return t.endsWith(q + suf) && PREF_RE.test(t);
    });
    if (coordsOk(hit)) return hit!;
  }
  // クエリ自体が都道府県名で始まる完全住所（例: 東京都渋谷区宇田川町5）は先頭を信用
  if (PREF_RE.test(q)) {
    if (coordsOk(arr[0])) return arr[0];
  }
  // 該当なし → null（呼び出し側が Google Geocoding=有名度順 へフォールバック）
  return null;
}
