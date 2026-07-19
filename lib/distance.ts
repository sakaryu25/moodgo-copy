// ─── 距離の単一ソース（全検索経路で共通利用）──────────────────────────────────
// これまで距離は「ソート用distanceKm(haversine)」と「表示用distanceText(PostGIS
// distance_m由来 or 別フォーマッタ)」が別計算でズレていた。ここに集約し、
//   ① 1つの数値(km)から ② 1つのフォーマッタで表示テキストを作る ことで統一する。

// 2点間のヒュベニ近似（haversine）距離[m]
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 現在地からの距離[km]を「最も正確な順」で1つ決める:
//   distance_m(PostGIS・最精密) → 座標からのhaversine → 既存値 → undefined
export function distanceKmFor(opts: {
  distanceM?: number | null;
  lat?: number | null;
  lng?: number | null;
  originLat?: number | null;
  originLng?: number | null;
  fallbackKm?: number;
}): number | undefined {
  const { distanceM, lat, lng, originLat, originLng, fallbackKm } = opts;
  if (typeof distanceM === "number" && distanceM >= 0) return distanceM / 1000;
  if (typeof lat === "number" && typeof lng === "number" &&
      typeof originLat === "number" && typeof originLng === "number") {
    return haversineMeters(originLat, originLng, lat, lng) / 1000;
  }
  return typeof fallbackKm === "number" && fallbackKm >= 0 ? fallbackKm : undefined;
}

// 交通手段に応じた距離テキスト（例: "車で約15分 / 12.3km"）。全経路でこの1つを使う。
//   速度: 車/バイク/なんでも=40, 電車/バス=30, 自転車=12, 徒歩=4 km/h
//   overrideDurationText: Google Route Matrix等の実所要時間("15分")があれば推定の代わりに使う。
//   （レガシー経路が実距離・実時間を保ちつつ統一形式で表示するために使用）
export function formatDistText(km: number, transport?: string | string[], overrideDurationText?: string): string {
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  let speed = 40, mode = "車";
  if (t.includes("電車") || t.includes("バス")) { speed = 30; mode = "電車"; }
  else if (t.includes("自転車")) { speed = 12; mode = "自転車"; }
  else if (t.includes("徒歩")) { speed = 4; mode = "歩き"; }
  // 車/バイク/なんでも/未指定 は車(40)のまま
  let timeStr: string;
  if (overrideDurationText && overrideDurationText.trim().length > 0) {
    timeStr = overrideDurationText.trim();
  } else {
    const mins = Math.round((km / speed) * 60);
    timeStr = mins < 60
      ? `${mins}分`
      : `${Math.floor(mins / 60)}時間${mins % 60 > 0 ? (mins % 60) + "分" : ""}`;
  }
  return `${mode}で約${timeStr} / ${km.toFixed(1)}km`;
}

// ── 遠出リングの層化スプレッド（far-bias専用・2026-07-19 品質監査で導入）───────────
//   問題: 遠リング[min,radius]を単純な「遠い順+limit」で並べると、全て外縁(例:小旅行=120km付近の
//     2km幅)に密集し、距離・方位の多様性が消える(監査で最低スコア)。
//   対策: [min,radius]を bands 個の距離バンドに層化し、遠いバンドほど厚く配分して巡回抽出する。
//     → 「遠い順」の意図(遠いバンドが上位)を保ちつつ、全域(96〜120km等)に遠寄りで散らす。
//   items: 並べ替え対象 / kmOf: 各要素の距離km / loKm..hiKm: リングの内外半径 / tieBreak: 同バンド内の任意副キー(小さいほど上位)。
export function farLeanSpread<T>(
  items: T[],
  kmOf: (x: T) => number,
  loKm: number,
  hiKm: number,
  opts?: { bands?: number; tieBreak?: (x: T) => number },
): T[] {
  const bands = Math.max(2, opts?.bands ?? 5);
  const span = Math.max(hiKm - loKm, 0.001);
  const tieBreak = opts?.tieBreak;
  const buckets: T[][] = Array.from({ length: bands }, () => []);
  for (const it of items) {
    const km = kmOf(it);
    // 0 = 最遠バンド(hi寄り), bands-1 = 最近バンド(lo寄り)
    let b = Math.floor(((hiKm - km) / span) * bands);
    b = Math.min(bands - 1, Math.max(0, b));
    buckets[b].push(it);
  }
  // 各バンド内: (任意副キー) → 遠い順 → 微ノイズ
  for (const bk of buckets) {
    bk.sort((a, c) => {
      if (tieBreak) { const t = tieBreak(a) - tieBreak(c); if (t !== 0) return t; }
      return (kmOf(c) - kmOf(a)) + (Math.random() - 0.5) * 2;
    });
  }
  // 遠バンドを厚めに: 1巡目はバンドiから (bands - i) 件（遠いほど多い）、以降は1件ずつ巡回。
  const out: T[] = [];
  let pass = 0;
  while (buckets.some((b) => b.length)) {
    for (let i = 0; i < bands; i++) {
      const take = pass === 0 ? Math.max(1, bands - i) : 1;
      for (let k = 0; k < take && buckets[i].length; k++) out.push(buckets[i].shift() as T);
    }
    pass++;
  }
  return out;
}
