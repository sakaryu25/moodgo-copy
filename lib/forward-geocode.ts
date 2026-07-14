// ── lib/forward-geocode.ts ────────────────────────────────────────────────────
// 順ジオコーディング（住所/名前 → 座標）。投稿時に住所しか無い新スポットへ座標を
// 補完するため（座標はユーザーには見せない内部データ＝距離計算・重複防止・検索対象化に使う）。
// コスト削減: Yahoo!ジオコーダ(無料枠・YAHOO_LOCAL_SEARCH_API_KEY流用)を一次、
//   失敗時のみ Google Geocoding(課金)で救済。reverse-geocode と同じ方針。
export async function forwardGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = String(query ?? "").trim();
  if (q.length < 3) return null;

  // ① Yahoo!ジオコーダ（無料）
  const appid = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (appid) {
    try {
      const url = new URL("https://map.yahooapis.jp/geocode/V1/geoCoder");
      url.searchParams.set("query", q);
      url.searchParams.set("appid", appid);
      url.searchParams.set("output", "json");
      url.searchParams.set("results", "1");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const coords = data?.Feature?.[0]?.Geometry?.Coordinates;   // "経度,緯度" の文字列
        if (typeof coords === "string") {
          const [lng, lat] = coords.split(",").map(Number);
          if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) return { lat, lng };
        }
      }
    } catch { /* Googleへフォールバック */ }
  }

  // ② Google Geocoding（課金・Yahoo不可時のみ）
  const key = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&language=ja&region=JP&key=${key}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      const loc = data?.results?.[0]?.geometry?.location;
      if (loc && isFinite(loc.lat) && isFinite(loc.lng)) return { lat: Number(loc.lat), lng: Number(loc.lng) };
    } catch { /* 諦め（座標なしで続行） */ }
  }
  return null;
}
