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
