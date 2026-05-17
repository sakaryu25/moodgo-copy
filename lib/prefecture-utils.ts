// ─── 都道府県ユーティリティ ──────────────────────────────────────────────────
// 都道府県の重心座標と近隣都道府県の計算

export const PREFECTURES: { name: string; lat: number; lng: number }[] = [
  { name: "北海道", lat: 43.064, lng: 141.347 },
  { name: "青森県", lat: 40.824, lng: 140.740 },
  { name: "岩手県", lat: 39.704, lng: 141.153 },
  { name: "宮城県", lat: 38.269, lng: 140.872 },
  { name: "秋田県", lat: 39.719, lng: 140.102 },
  { name: "山形県", lat: 38.240, lng: 140.364 },
  { name: "福島県", lat: 37.750, lng: 140.468 },
  { name: "茨城県", lat: 36.341, lng: 140.447 },
  { name: "栃木県", lat: 36.566, lng: 139.883 },
  { name: "群馬県", lat: 36.391, lng: 139.060 },
  { name: "埼玉県", lat: 35.857, lng: 139.649 },
  { name: "千葉県", lat: 35.606, lng: 140.123 },
  { name: "東京都", lat: 35.690, lng: 139.692 },
  { name: "神奈川県", lat: 35.447, lng: 139.642 },
  { name: "新潟県", lat: 37.902, lng: 139.023 },
  { name: "富山県", lat: 36.695, lng: 137.211 },
  { name: "石川県", lat: 36.594, lng: 136.626 },
  { name: "福井県", lat: 36.065, lng: 136.222 },
  { name: "山梨県", lat: 35.664, lng: 138.568 },
  { name: "長野県", lat: 36.651, lng: 138.181 },
  { name: "岐阜県", lat: 35.391, lng: 136.722 },
  { name: "静岡県", lat: 34.977, lng: 138.383 },
  { name: "愛知県", lat: 35.180, lng: 136.907 },
  { name: "三重県", lat: 34.730, lng: 136.509 },
  { name: "滋賀県", lat: 35.004, lng: 135.869 },
  { name: "京都府", lat: 35.021, lng: 135.756 },
  { name: "大阪府", lat: 34.686, lng: 135.520 },
  { name: "兵庫県", lat: 34.691, lng: 135.183 },
  { name: "奈良県", lat: 34.685, lng: 135.805 },
  { name: "和歌山県", lat: 34.226, lng: 135.168 },
  { name: "鳥取県", lat: 35.504, lng: 134.238 },
  { name: "島根県", lat: 35.472, lng: 133.051 },
  { name: "岡山県", lat: 34.662, lng: 133.935 },
  { name: "広島県", lat: 34.396, lng: 132.460 },
  { name: "山口県", lat: 34.186, lng: 131.471 },
  { name: "徳島県", lat: 34.066, lng: 134.560 },
  { name: "香川県", lat: 34.340, lng: 134.043 },
  { name: "愛媛県", lat: 33.842, lng: 132.766 },
  { name: "高知県", lat: 33.560, lng: 133.531 },
  { name: "福岡県", lat: 33.607, lng: 130.418 },
  { name: "佐賀県", lat: 33.249, lng: 130.299 },
  { name: "長崎県", lat: 32.745, lng: 129.873 },
  { name: "熊本県", lat: 32.790, lng: 130.742 },
  { name: "大分県", lat: 33.238, lng: 131.613 },
  { name: "宮崎県", lat: 31.911, lng: 131.424 },
  { name: "鹿児島県", lat: 31.560, lng: 130.558 },
  { name: "沖縄県", lat: 26.212, lng: 127.681 },
];

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** ユーザーのlat/lngから最も近い都道府県を返す */
export function detectUserPrefecture(lat: number, lng: number): string {
  if (!lat && !lng) return "";
  let best = PREFECTURES[0];
  let bestDist = Infinity;
  for (const pref of PREFECTURES) {
    const d = distKm(lat, lng, pref.lat, pref.lng);
    if (d < bestDist) { bestDist = d; best = pref; }
  }
  return best.name;
}

/** ユーザーの都道府県から近い順に隣県をN件返す（自県は除く） */
export function getNearbyPrefectures(userPref: string, count = 3): string[] {
  const base = PREFECTURES.find(p => p.name === userPref);
  if (!base) return [];
  return PREFECTURES
    .filter(p => p.name !== userPref)
    .map(p => ({ name: p.name, dist: distKm(base.lat, base.lng, p.lat, p.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map(p => p.name);
}
