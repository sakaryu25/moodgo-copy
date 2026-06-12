// ── Yahoo!リバースジオコーダ ─────────────────────────────────────────────────
// Google Geocoding API が使えない場合（課金未設定等）のフォールバック。
// 検索で使用中の YAHOO_LOCAL_SEARCH_API_KEY をそのまま流用できる（無料枠）。
type YahooAddressElement = { Name?: string; Kind?: string };

export type YahooReverseResult = {
  area: string;              // 検索用エリア（市区＋町名）
  displayArea: string;       // 表示用（都道府県〜町名）
  fullAddress: string;       // フル住所（番地まで）
  prefecture: string | null;
  city: string | null;
  oaza: string | null;       // 町名
};

export async function yahooReverseGeocode(latitude: number, longitude: number): Promise<YahooReverseResult | null> {
  const appid = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!appid) return null;
  try {
    const url = new URL("https://map.yahooapis.jp/geoapi/V1/reverseGeoCoder");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("appid", appid);
    url.searchParams.set("output", "json");
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const prop = data?.Feature?.[0]?.Property;
    if (!prop?.Address) return null;

    const elements: YahooAddressElement[] = Array.isArray(prop.AddressElement) ? prop.AddressElement : [];
    const byKind = (kind: string) => elements.find((e) => e.Kind === kind)?.Name ?? null;
    const prefecture = byKind("prefecture");
    const city = byKind("city");
    const oaza = byKind("oaza");

    const fullAddress = String(prop.Address).normalize("NFKC").trim();
    const area = [city, oaza].filter(Boolean).join("") || city || prefecture || "";
    if (!area && !fullAddress) return null;
    const displayArea = [prefecture, city, oaza].filter(Boolean).join("") || fullAddress;

    return { area: area || fullAddress, displayArea, fullAddress, prefecture, city, oaza };
  } catch {
    return null;
  }
}
