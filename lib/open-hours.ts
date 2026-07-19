// ── lib/open-hours.ts (P9) ────────────────────────────────────────────────────
// places.open_hours の日本語・曜日別テキスト（Google weekdayDescriptions 由来）を
//   オフラインで解析し、JST の「今この瞬間」に営業中かを判定する純関数。
// 形式例:
//   月曜日: 11時30分～19時00分
//   火曜日: 11時00分～15時00分, 17時30分～22時00分   （分割営業）
//   水曜日: 定休日
//   木曜日: 24 時間営業
//   金曜日: 17時00分～0時00分     （0時終わり=24:00）
//   土曜日: 23時00分～2時00分     （日跨ぎ深夜営業）
// 方針: 確信を持って解釈できた時だけ true/false。曖昧・未知トークン・行欠落は null（＝不明・無害）。
//   API/LLMを使わずDB主経路(find_nearby_places)の「営業中」並び/バッジを効かせるのが狙い。

const DOW: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

type Range = { s: number; e: number; cross: boolean };   // 分（0-1440）。cross=翌日にまたぐ深夜営業
type DaySpec = Range[] | "closed" | "always" | null;      // null=行はあるが解釈不能

function parseDayTimes(times: string): DaySpec {
  const t = times.trim();
  if (!t) return null;
  if (/定休|休(?:み|業|館|園)|closed|クローズ/i.test(t)) return "closed";
  if (/24\s*時間|終日|24h/i.test(t)) return "always";
  const ranges: Range[] = [];
  for (const part of t.split(/[,、]/)) {
    if (!part.trim()) continue;
    // 「H時MM分〜H時MM分」と「HH:MM〜HH:MM」の両形式を受ける（単一行スポット対応）。
    const m = part.match(/(\d{1,2})\s*(?:時|[:：])\s*(\d{1,2})?\s*分?\s*[～〜~\-–—]\s*(\d{1,2})\s*(?:時|[:：])\s*(\d{1,2})?\s*分?/);
    if (!m) return null;   // 1つでも読めない部分があれば全体を不明扱い（誤判定より安全）
    const s = (+m[1]) * 60 + (+(m[2] ?? 0));
    let e = (+m[3]) * 60 + (+(m[4] ?? 0));
    // 例: 「17時～0時」の 0時 は 24:00（日跨ぎではなく当日終わり）。
    const cross = e !== 0 && e <= s;   // 例: 23:00～2:00 は翌日にまたぐ
    if (e === 0) e = 1440;
    ranges.push({ s, e, cross });
  }
  return ranges.length ? ranges : null;
}

/** 曜日別テキストから JST の now に営業中か。true/false/null(不明)。 */
export function isOpenNowFromWeekdayText(text: string | null | undefined, now: Date = new Date()): boolean | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  // JST（サーバはUTCなので +9h して getUTC* を使う）
  const jstEarly = new Date(now.getTime() + 9 * 3600 * 1000);
  const nowMinEarly = jstEarly.getUTCHours() * 60 + jstEarly.getUTCMinutes();

  // 単一行（全曜日共通）: 「10:00〜22:00」「24時間営業」「9時〜17時」等。曜日別でなくても営業中を判定する。
  if (!/曜/.test(raw)) {
    const spec = parseDayTimes(raw);
    if (spec === "always") return true;
    if (!Array.isArray(spec)) return null;   // "定休日"のみ等は曜日不明のため判定しない（null=無害）
    for (const r of spec) {
      if (r.cross) { if (nowMinEarly >= r.s || nowMinEarly < r.e) return true; }   // 全日同一＝前日spillも同レンジ
      else if (nowMinEarly >= r.s && nowMinEarly < r.e) return true;
    }
    return false;
  }
  const byDow: (DaySpec | undefined)[] = new Array(7).fill(undefined);
  for (const line of raw.split(/\n/)) {
    const mm = line.match(/([日月火水木金土])\s*曜日?\s*[:：]\s*(.+)$/);
    if (!mm) continue;
    byDow[DOW[mm[1]]] = parseDayTimes(mm[2]);
  }
  // JST（サーバはUTCなので +9h して getUTC* を使う）
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = jst.getUTCDay();
  const nowMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const today = byDow[dow];
  const yest = byDow[(dow + 6) % 7];

  if (today === null) return null;                 // 今日の行が解釈不能 → 不明
  if (today === "always") return true;
  let todayKnown = false;
  if (Array.isArray(today)) {
    todayKnown = true;
    for (const r of today) {
      if (r.cross) { if (nowMin >= r.s) return true; }        // 深夜営業の当日前半（start〜24:00）
      else if (nowMin >= r.s && nowMin < r.e) return true;    // 通常レンジ
    }
  } else if (today === "closed") {
    todayKnown = true;
  }
  // 昨日の深夜営業が今朝に伸びている分（例: 昨日 23:00〜2:00 → 今日 0:00〜2:00 は営業中）
  if (yest === "always") return true;
  if (Array.isArray(yest)) {
    for (const r of yest) if (r.cross && nowMin < r.e) return true;
  }
  return todayKnown ? false : null;   // 今日の行があり該当せず=閉店。今日の行が無ければ不明(null)
}
