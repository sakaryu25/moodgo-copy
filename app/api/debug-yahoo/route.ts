import { NextResponse } from "next/server";

// 一時デバッグ用: fetchYahooSupplement が実際に使うクエリ条件でYahooを叩き、
// 各段階の件数を返して0件化の原因を切り分ける。切り分け後に削除すること。
export async function GET(req: Request) {
  const key = process.env.YAHOO_LOCAL_SEARCH_API_KEY ?? "";
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") ?? "個室居酒屋 居酒屋完全個室";
  const gc = searchParams.get("gc") ?? "0105001";
  const sort = searchParams.get("sort") ?? "score";
  const lat = 35.465, lon = 139.622;

  const build = (withGc: boolean) => {
    const p = new URLSearchParams({
      appid: key, lat: String(lat), lon: String(lon),
      dist: "10", results: "20", start: "1", sort, output: "json", query,
      ...(withGc ? { gc } : {}),
    });
    return `https://map.yahooapis.jp/search/local/V1/localSearch?${p}`;
  };

  const run = async (withGc: boolean) => {
    try {
      const r = await fetch(build(withGc), { signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      let count = -1, names: string[] = [];
      try {
        const d = JSON.parse(text);
        count = d?.ResultInfo?.Count ?? -1;
        names = (d?.Feature ?? []).slice(0, 5).map((f: { Name?: string }) => f.Name ?? "");
      } catch { /* not json */ }
      return { httpStatus: r.status, count, names, bodyHead: count < 0 ? text.slice(0, 150) : undefined };
    } catch (e) {
      return { error: String(e) };
    }
  };

  return NextResponse.json({
    query, gc, sort,
    withGc: await run(true),
    withoutGc: await run(false),
  });
}
