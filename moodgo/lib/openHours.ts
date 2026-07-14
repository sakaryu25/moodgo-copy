// ── lib/openHours.ts ──────────────────────────────────────────────────────────
// 利用者が投稿した営業時間文字列から「今営業中か」を判定する。
// 対応形式（post.tsx composedHours が生成する形）:
//   "24時間営業" / "HH:MM〜HH:MM" / それぞれ＋"（水・木曜定休）" / "水曜定休"のみ
// Google由来の openNow が無いユーザー作成スポットでも 営業中/閉店中 バッジを出すための補完。
// 判定できない形式は null（バッジ非表示＝従来どおり）。
export function userHoursOpenNow(text?: string | null, now: Date = new Date()): boolean | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  // 定休日: 今日が「◯曜定休」に含まれていたら閉店
  const DAYS = ['日', '月', '火', '水', '木', '金', '土'];   // Date#getDay の順
  const today = DAYS[now.getDay()];
  const cm = s.match(/([月火水木金土日](?:・[月火水木金土日])*)曜定休/);
  if (cm && cm[1].split('・').includes(today)) return false;
  if (s.includes('24時間営業')) return true;
  const m = s.match(/(\d{1,2}):(\d{2})\s*[〜~\-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  const open = Number(m[1]) * 60 + Number(m[2]);
  const close = Number(m[3]) * 60 + Number(m[4]);
  if (open === close) return null;
  // 深夜跨ぎ（例 18:00〜02:00）は「開店以降 or 閉店前」
  return open < close ? cur >= open && cur < close : cur >= open || cur < close;
}
