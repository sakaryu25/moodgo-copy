import { NextResponse } from "next/server";

// 一時デバッグ用: 本番環境からYahooローカルサーチを呼び、生の結果を返す。
// Yahoo不調の原因（鍵不正 / IPブロック）を切り分けたら削除すること。
export async function GET() {
  const key = process.env.YAHOO_LOCAL_SEARCH_API_KEY ?? "";
  const keyInfo = {
    present: key.length > 0,
    length: key.length,
    head: key.slice(0, 4),
    hasWhitespace: /\s/.test(key),
  };
  const url = `https://map.yahooapis.jp/search/local/V1/localSearch?appid=${encodeURIComponent(
    key,
  )}&lat=35.465&lon=139.622&dist=5&output=json&query=cafe`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const text = await r.text();
    return NextResponse.json({
      keyInfo,
      httpStatus: r.status,
      bodyHead: text.slice(0, 200),
      isJson: text.trimStart().startsWith("{"),
    });
  } catch (e) {
    return NextResponse.json({ keyInfo, error: String(e) });
  }
}
