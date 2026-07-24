// ── 営業時間の共通パーサー／営業中判定 ─────────────────────────────────────────
// place.tsx(場所詳細) と community-spot.tsx(投稿詳細) で「見え方」を統一するための共有ロジック。
//   ・同じ時間帯の曜日をグループ化（例: 月〜日曜 11:00〜22:30 / 月曜だけ違えば 月曜…＋火〜日曜…）。
//   ・openNow が不明(null)な投稿でも、テキストから現在の営業/閉店を推定してバッジを出せる。

const DAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

export type HoursRow = { label: string; time: string; isToday?: boolean };

/** "月曜日: 9:00〜23:00" 等の複数行テキストを、同一時間帯の曜日でグループ化した行に整形。 */
export function formatOpeningHours(text: string): HoursRow[] {
  const today = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  type Entry = { day: string; hours: string };
  const parsed: Entry[] = [];
  let parseOk = true;
  for (const line of lines) {
    const m = line.match(/^([月火水木金土日])曜日?[：:]\s*(.+)$/);
    if (!m) { parseOk = false; break; }
    parsed.push({ day: m[1], hours: m[2].trim() });
  }

  if (parseOk && parsed.length > 0) {
    parsed.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
    const groups: { days: string[]; hours: string }[] = [];
    for (const { day, hours } of parsed) {
      const last = groups[groups.length - 1];
      if (last && last.hours === hours) last.days.push(day);
      else groups.push({ days: [day], hours });
    }
    return groups.map(({ days, hours }) => {
      let label: string;
      if (days.length === 1) {
        label = `${days[0]}曜`;
      } else {
        const startIdx = DAY_ORDER.indexOf(days[0]);
        const isConsecutive = days.every((d, i) => DAY_ORDER.indexOf(d) === startIdx + i);
        label = (isConsecutive && days.length >= 3)
          ? `${days[0]}〜${days[days.length - 1]}曜`
          : days.map((d) => `${d}曜`).join('・');
      }
      return { label, time: hours, isToday: days.includes(today) };
    });
  }

  // フォールバック: 行ごとにそのまま表示（ラベルと時間を ": " で分割・時刻の10:00は割らない）
  return lines.map((line) => {
    const sep = line.indexOf(':');
    if (sep > 0 && sep < 10 && !/^\d+$/.test(line.slice(0, sep).trim())) {
      const label = line.slice(0, sep).trim();
      const time = line.slice(sep + 1).trim();
      const dayChar = label.charAt(0);
      const isToday = ['月', '火', '水', '木', '金', '土', '日'].includes(dayChar) && dayChar === today;
      return { label, time, isToday };
    }
    return { label: '', time: line };
  });
}

// "9時30分" / "9:30" / "930" などを分に変換。
function toMinutes(h: string, m: string): number { return parseInt(h, 10) * 60 + (m ? parseInt(m, 10) : 0); }

/** 営業時間テキストから「今 営業中か」を推定。判定できなければ null。 */
export function isOpenNowFromText(text: string | null | undefined): boolean | null {
  const rows = formatOpeningHours(String(text ?? ''));
  if (rows.length === 0) return null;
  const todayChar = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
  // 今日の行を優先、無ければ isToday、それも無ければ最初の行。
  const row = rows.find((r) => r.isToday) ?? rows.find((r) => r.label.includes(todayChar)) ?? (rows.length === 1 ? rows[0] : null);
  if (!row) return null;
  const time = row.time;
  if (/24\s*時間|終日|always/i.test(time)) return true;
  if (/定休|休み|休業|closed|クローズ/i.test(time)) return false;
  // "11時00分〜22時30分" / "11:00〜22:30" / "11:00-22:30" 等（複数レンジは最初の1つで判定）
  const m = time.match(/(\d{1,2})[:：時]?\s*(\d{0,2})\s*[分]?\s*[〜~\-–ー]\s*(\d{1,2})[:：時]?\s*(\d{0,2})/);
  if (!m) return null;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(m[1], m[2]);
  let end = toMinutes(m[3], m[4]);
  if (end <= start) end += 24 * 60;                       // 翌日まで営業（例: 18:00〜翌2:00）
  const nm = nowMin < start ? nowMin + 24 * 60 : nowMin;  // 深夜跨ぎの比較
  return nm >= start && nm < end;
}
