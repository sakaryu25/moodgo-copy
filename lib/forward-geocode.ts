// ── lib/forward-geocode.ts ────────────────────────────────────────────────────
// 順ジオコーディング（住所/名前 → 座標）。投稿時に住所しか無い新スポットへ座標を
// 補完するため（座標はユーザーには見せない内部データ＝距離計算・重複防止・検索対象化に使う）。
// 完全無料方針（ユーザー指示 2026-07-15）: ① 国土地理院GSI（完全無料・キー不要）→ ② Yahoo（無料枠）。
//   Google Geocoding(課金)は使わない。日本の住所/施設名はGSI+Yahooでほぼ賄える。
import { pickGsiResult } from "@/lib/gsi-geocode";

export async function forwardGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = String(query ?? "").trim();
  if (q.length < 3) return null;

  // ① 国土地理院GSI（完全無料・キー不要）。有名度順でないため pickGsiResult で行政区画一致を選ぶ
  //   （「渋谷」[0]=福島県猪苗代町渋谷 等の誤マッチ対策）。47都道府県名だけの検索は pickGsiResult が弾く。
  try {
    const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const arr = await res.json().catch(() => null);
    const best = pickGsiResult(arr, q);
    const c = best?.geometry?.coordinates;   // [lng, lat]
    if (Array.isArray(c) && typeof c[1] === "number" && typeof c[0] === "number") {
      const lat = Number(c[1]), lng = Number(c[0]);
      if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) return { lat, lng };
    }
  } catch { /* Yahooへフォールバック */ }

  // ② Yahoo!ジオコーダ（無料枠・YAHOO_LOCAL_SEARCH_API_KEY流用）
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
    } catch { /* 諦め（座標なしで続行＝admin側で後から無料補完可能） */ }
  }

  return null;   // 無料2ソースで特定できなければ座標なし（Google課金は使わない）
}
