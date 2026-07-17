"use client";
// ── 県別 特集ページ管理 ─────────────────────────────────────────────────────
// /admin/featured-pages
// バナー / 気分カード / おすすめスポット を県ごとに編集できる管理者ページ

import { useEffect, useRef, useState } from "react";

// ─── 定数 ──────────────────────────────────────────────────────────────────

// admin secret はハードコードしない。localStorage(moodgo-admin-secret)から読み、サーバが検証する。

const PREFECTURES = [
  "全国",
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

// 地方（scope_type='region'）のときの scope_key 候補
const REGIONS = ["北海道・東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"];

// 掲載位置（slot_type）の選択肢
const SLOT_OPTIONS: { value: string; label: string }[] = [
  { value: "hero",   label: "hero（メイン特集）" },
  { value: "sub_1",  label: "sub_1（サブ左）" },
  { value: "sub_2",  label: "sub_2（サブ右）" },
  { value: "normal", label: "normal（通常）" },
  { value: "hidden", label: "hidden（TOP非表示）" },
];
const SLOT_LABEL: Record<string, string> = {
  hero: "メイン", sub_1: "サブ左", sub_2: "サブ右", normal: "通常", hidden: "非表示",
};

const FEATHER_ICONS = [
  "umbrella", "star", "heart", "sun", "cloud", "map-pin", "coffee",
  "camera", "music", "compass", "zap", "smile", "moon", "wind",
  "anchor", "activity", "award", "bookmark", "box", "truck",
];

const IONICONS_LIST = [
  "body", "chatbubble-ellipses", "cloudy", "heart", "star",
  "cafe", "car", "book", "bicycle", "fitness", "airplane",
  "restaurant", "camera", "musical-notes", "walk", "leaf",
  "flash", "globe", "home", "people",
];

const PRESET_COLORS = [
  { color: "#E56B9B", label: "ピンク" },
  { color: "#9B5ED4", label: "パープル" },
  { color: "#D98C30", label: "オレンジ" },
  { color: "#4D84C4", label: "ブルー" },
  { color: "#3DAA6E", label: "グリーン" },
  { color: "#C44D4D", label: "レッド" },
  { color: "#8B6914", label: "ブラウン" },
  { color: "#5B7FA6", label: "スレート" },
];

const PRESET_BG_COLORS = [
  { color: "#FCE8F0", label: "ピンク" },
  { color: "#F3EAFF", label: "パープル" },
  { color: "#FFF4E3", label: "オレンジ" },
  { color: "#E8F1FF", label: "ブルー" },
  { color: "#E8F5EE", label: "グリーン" },
  { color: "#FFECEC", label: "レッド" },
  { color: "#FBF5E6", label: "ブラウン" },
  { color: "#F0F4F8", label: "グレー" },
];

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface PageListItem {
  id: string;
  prefecture: string;
  issue: string;
  is_active: boolean;
  scope_type?: string | null;      // prefecture / region / nationwide
  scope_key?: string | null;       // 神奈川県 / 関東 / 全国 など
  slot_type?: string | null;       // hero / sub_1 / sub_2 / normal / hidden
  publish_start?: string | null;   // timestamptz（NULL=制限なし）
  publish_end?: string | null;
  updated_at: string;
  featured_page_moods: { id: string }[];
  featured_page_spots: { id: string }[];
}

interface MoodDraft {
  title: string;
  icon_name: string;
  icon_color: string;
  bg_color: string;
}

interface MenuItemDraft {
  name: string;
  category: string;
  price: string;
  description: string;
  image_url: string;
}

interface EventDraft {
  title: string;
  start_date: string;
  end_date: string;
  description: string;
  image_url: string;
}

type DayHours = { open: string; close: string; closed: boolean };
type HoursDraft = {
  mon: DayHours; tue: DayHours; wed: DayHours; thu: DayHours;
  fri: DayHours; sat: DayHours; sun: DayHours;
  note: string;
};

const WEEKDAYS: { key: keyof Omit<HoursDraft, "note">; label: string }[] = [
  { key: "mon", label: "月" },
  { key: "tue", label: "火" },
  { key: "wed", label: "水" },
  { key: "thu", label: "木" },
  { key: "fri", label: "金" },
  { key: "sat", label: "土" },
  { key: "sun", label: "日" },
];

function emptyDay(): DayHours {
  return { open: "", close: "", closed: false };
}

function emptyHours(): HoursDraft {
  return {
    mon: emptyDay(), tue: emptyDay(), wed: emptyDay(), thu: emptyDay(),
    fri: emptyDay(), sat: emptyDay(), sun: emptyDay(), note: "",
  };
}

interface SpotDraft {
  title: string;
  shop_name: string;
  location: string;
  catch_copy: string;
  description: string;
  image_url: string;
  gallery_image_urls: string[];
  tags: string[];
  features: string[];
  address: string;
  access: string;
  phone: string;
  website: string;
  instagram: string;
  congestion_info: string;
  closed_days: string;
  hours: HoursDraft;
  menu_items: MenuItemDraft[];
  events: EventDraft[];
}

function emptySpot(): SpotDraft {
  return {
    title: "", shop_name: "", location: "", catch_copy: "", description: "", image_url: "",
    gallery_image_urls: [], tags: [], features: [],
    address: "", access: "", phone: "", website: "", instagram: "",
    congestion_info: "", closed_days: "", hours: emptyHours(),
    menu_items: [], events: [],
  };
}

// DBから読み込んだスポット（新カラムが無い古い行も想定）を SpotDraft に正規化
function normalizeSpot(s: any): SpotDraft {
  const base = emptySpot();
  return {
    ...base,
    title: s.title ?? "",
    shop_name: s.shop_name ?? "",
    location: s.location ?? "",
    catch_copy: s.catch_copy ?? "",
    description: s.description ?? "",
    image_url: s.image_url ?? "",
    gallery_image_urls: Array.isArray(s.gallery_image_urls) ? s.gallery_image_urls : [],
    tags: Array.isArray(s.tags) ? s.tags : [],
    features: Array.isArray(s.features) ? s.features : [],
    address: s.address ?? "",
    access: s.access ?? "",
    phone: s.phone ?? "",
    website: s.website ?? "",
    instagram: s.instagram ?? "",
    congestion_info: s.congestion_info ?? "",
    closed_days: s.closed_days ?? "",
    hours: s.hours && typeof s.hours === "object" && Object.keys(s.hours).length
      ? { ...emptyHours(), ...s.hours }
      : emptyHours(),
    menu_items: Array.isArray(s.menu_items) ? s.menu_items : [],
    events: Array.isArray(s.events) ? s.events : [],
  };
}

interface PageDraft {
  id: string | null;
  prefecture: string;
  issue: string;
  label: string;
  banner_title: string;
  banner_description: string;
  banner_image_url: string;
  banner_icon: string;
  is_active: boolean;
  sort_order: number;
  scope_type: string;      // prefecture / region / nationwide
  scope_key: string;       // 神奈川県 / 関東 / 全国 など
  slot_type: string;       // hero / sub_1 / sub_2 / normal / hidden
  publish_start: string;   // datetime-local形式（空=制限なし）
  publish_end: string;
  moods: MoodDraft[];
  spots: SpotDraft[];
}

// ─── 初期値 ────────────────────────────────────────────────────────────────

function emptyDraft(prefecture = ""): PageDraft {
  return {
    id: null,
    prefecture,
    issue: "6月号",
    label: "今月の特集",
    banner_title: "",
    banner_description: "",
    banner_image_url: "",
    banner_icon: "umbrella",
    is_active: true,
    sort_order: 0,
    scope_type: prefecture === "全国" ? "nationwide" : "prefecture",
    scope_key: prefecture,
    slot_type: "normal",
    publish_start: "",
    publish_end: "",
    moods: [
      { title: "ひとりで\n整いたい", icon_name: "body", icon_color: "#9B5ED4", bg_color: "#F3EAFF" },
      { title: "友達と\n話したい夜", icon_name: "chatbubble-ellipses", icon_color: "#D98C30", bg_color: "#FFF4E3" },
      { title: "雨の日でも\n楽しめる", icon_name: "cloudy", icon_color: "#4D84C4", bg_color: "#E8F1FF" },
    ],
    spots: [],
  };
}

// ─── ユーティリティ ─────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// timestamptz(ISO) → <input type="datetime-local"> 値（ローカル時刻）
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// <input type="datetime-local"> 値 → ISO文字列（空=null）
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// 公開状態の判定（is_active × 公開期間 × slot）
function publishStatus(p: { is_active: boolean; slot_type?: string | null; publish_start?: string | null; publish_end?: string | null }) {
  if (!p.is_active) return { label: "非公開", bg: "#fee2e2", color: "#dc2626" };
  const now = Date.now();
  if (p.publish_start && new Date(p.publish_start).getTime() > now) return { label: "公開前", bg: "#fef3c7", color: "#b45309" };
  if (p.publish_end && new Date(p.publish_end).getTime() <= now) return { label: "期間外", bg: "#fef3c7", color: "#b45309" };
  if ((p.slot_type ?? "normal") === "hidden") return { label: "TOP非表示", bg: "#e5e7eb", color: "#4b5563" };
  return { label: "公開中", bg: "#dcfce7", color: "#16a34a" };
}

// ─── スタイル定数 ──────────────────────────────────────────────────────────

const PINK = "#E56B9B";
const DARK = "#1a1a1a";
const GRAY = "#6b7280";
const BORDER = "#e5e7eb";
const BG = "#f9fafb";

const css = {
  // レイアウト
  page: { minHeight: "100vh", backgroundColor: BG, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" } as React.CSSProperties,
  body: { maxWidth: "1400px", margin: "0 auto", padding: "0 24px 40px" } as React.CSSProperties,
  cols: { display: "grid", gridTemplateColumns: "280px 1fr", gap: "24px", alignItems: "start" } as React.CSSProperties,

  // カード
  card: { background: "#fff", borderRadius: "16px", border: `1px solid ${BORDER}`, overflow: "hidden" } as React.CSSProperties,
  cardPad: { padding: "20px" } as React.CSSProperties,

  // ヘッダー
  header: { background: "#fff", borderBottom: `1px solid ${BORDER}`, padding: "16px 24px", display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" } as React.CSSProperties,
  headerTitle: { fontSize: "20px", fontWeight: 800, color: DARK } as React.CSSProperties,

  // セクション見出し
  secLabel: { fontSize: "11px", fontWeight: 700, color: GRAY, textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "8px" },
  secTitle: { fontSize: "14px", fontWeight: 700, color: DARK, marginBottom: "16px", paddingBottom: "10px", borderBottom: `1px solid ${BORDER}` },

  // フォーム
  label: { display: "block", fontSize: "12px", fontWeight: 700, color: DARK, marginBottom: "5px" } as React.CSSProperties,
  input: { width: "100%", boxSizing: "border-box" as const, border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "9px 12px", fontSize: "13px", outline: "none", background: "#fff", color: DARK } as React.CSSProperties,
  textarea: { width: "100%", boxSizing: "border-box" as const, border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "9px 12px", fontSize: "13px", outline: "none", background: "#fff", color: DARK, resize: "vertical" as const, lineHeight: "1.5" } as React.CSSProperties,
  select: { width: "100%", boxSizing: "border-box" as const, border: `1px solid ${BORDER}`, borderRadius: "8px", padding: "9px 12px", fontSize: "13px", background: "#fff", color: DARK } as React.CSSProperties,

  // ボタン
  btnPrimary: { background: PINK, color: "#fff", border: "none", borderRadius: "10px", padding: "11px 22px", fontWeight: 700, fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" } as React.CSSProperties,
  btnSecondary: { background: "#fff", color: DARK, border: `1px solid ${BORDER}`, borderRadius: "10px", padding: "9px 16px", fontWeight: 600, fontSize: "13px", cursor: "pointer" } as React.CSSProperties,
  btnDanger: { background: "#fff", color: "#ef4444", border: "1px solid #fca5a5", borderRadius: "8px", padding: "6px 12px", fontWeight: 600, fontSize: "12px", cursor: "pointer" } as React.CSSProperties,
  btnGhost: { background: "transparent", color: GRAY, border: "none", borderRadius: "6px", padding: "5px 10px", fontSize: "13px", cursor: "pointer" } as React.CSSProperties,

  // バッジ
  badgeActive: { background: "#dcfce7", color: "#16a34a", borderRadius: "999px", padding: "2px 10px", fontSize: "11px", fontWeight: 700 } as React.CSSProperties,
  badgeInactive: { background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "2px 10px", fontSize: "11px", fontWeight: 700 } as React.CSSProperties,

  // パスワード画面
  loginWrap: { display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: "16px" },
};

// ─── カラーピッカーUI ─────────────────────────────────────────────────────

function ColorSwatches({ value, options, onChange }: {
  value: string;
  options: { color: string; label: string }[];
  onChange: (c: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
      {options.map((o) => (
        <button
          key={o.color}
          title={o.label}
          onClick={() => onChange(o.color)}
          style={{
            width: "24px", height: "24px", borderRadius: "50%", border: value === o.color ? `3px solid ${DARK}` : "2px solid #ccc",
            background: o.color, cursor: "pointer", transition: "transform 0.1s",
          }}
        />
      ))}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#RRGGBB"
        style={{ ...css.input, width: "110px", flex: "none", fontSize: "12px", padding: "5px 8px" }}
      />
    </div>
  );
}

// ─── 気分カードエディター ─────────────────────────────────────────────────

function MoodEditor({ moods, onChange }: {
  moods: MoodDraft[];
  onChange: (m: MoodDraft[]) => void;
}) {
  const addMood = () => onChange([
    ...moods,
    { title: "新しい気分", icon_name: "heart", icon_color: "#E56B9B", bg_color: "#FCE8F0" },
  ]);

  const removeMood = (i: number) => onChange(moods.filter((_, idx) => idx !== i));

  const update = (i: number, field: keyof MoodDraft, value: string) => {
    const next = [...moods];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...moods];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      {moods.map((m, i) => (
        <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", background: "#fafafa" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontWeight: 700, fontSize: "13px", color: DARK }}>#{i + 1} 気分カード</span>
            <div style={{ display: "flex", gap: "4px" }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={css.btnGhost} title="上へ">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === moods.length - 1} style={css.btnGhost} title="下へ">↓</button>
              <button onClick={() => removeMood(i)} style={css.btnDanger}>削除</button>
            </div>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            {/* テキスト */}
            <div>
              <label style={css.label}>テキスト（改行OK）</label>
              <textarea
                value={m.title}
                onChange={(e) => update(i, "title", e.target.value)}
                rows={2}
                style={css.textarea}
                placeholder="ひとりで&#10;整いたい"
              />
            </div>

            {/* アイコン */}
            <div>
              <label style={css.label}>アイコン（Ionicons名）</label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <select value={m.icon_name} onChange={(e) => update(i, "icon_name", e.target.value)} style={{ ...css.select, flex: 1 }}>
                  {IONICONS_LIST.map((ic) => (
                    <option key={ic} value={ic}>{ic}</option>
                  ))}
                </select>
                <input
                  value={m.icon_name}
                  onChange={(e) => update(i, "icon_name", e.target.value)}
                  style={{ ...css.input, flex: 1 }}
                  placeholder="カスタム入力"
                />
              </div>
            </div>

            {/* アイコン色 */}
            <div>
              <label style={css.label}>アイコン色</label>
              <ColorSwatches value={m.icon_color} options={PRESET_COLORS} onChange={(c) => update(i, "icon_color", c)} />
            </div>

            {/* 背景色 */}
            <div>
              <label style={css.label}>カード背景色</label>
              <ColorSwatches value={m.bg_color} options={PRESET_BG_COLORS} onChange={(c) => update(i, "bg_color", c)} />
            </div>

            {/* プレビュー */}
            <div>
              <label style={css.label}>プレビュー</label>
              <div style={{
                display: "inline-flex", flexDirection: "column", alignItems: "center",
                background: m.bg_color, borderRadius: "14px", padding: "16px 20px", gap: "6px", minWidth: "80px",
              }}>
                <div style={{ fontSize: "24px" }}>●</div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: m.icon_color, textAlign: "center", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
                  {m.title}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      <button onClick={addMood} style={{ ...css.btnSecondary, width: "100%", justifyContent: "center", display: "flex" }}>
        ＋ 気分カードを追加
      </button>
    </div>
  );
}

// ─── スポットエディター ────────────────────────────────────────────────────

// 折りたたみ式サブセクション
function SubSection({ title, hint, children, defaultOpen }: { title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: "10px", background: "#fff", overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
          padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 700, fontSize: "13px", color: DARK }}
      >
        <span>{title}{hint && <span style={{ fontWeight: 400, color: GRAY, marginLeft: "8px", fontSize: "11px" }}>{hint}</span>}</span>
        <span style={{ color: GRAY }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

// 1行=1項目の配列フィールド（タグ・特徴・ギャラリーURL）
function LinesField({ label, value, onChange, placeholder, hint }: {
  label: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; hint?: string;
}) {
  return (
    <div>
      <label style={css.label}>{label}</label>
      <textarea
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((l) => l.trim()).filter(Boolean))}
        rows={Math.max(2, value.length + 1)}
        style={css.textarea}
        placeholder={placeholder}
      />
      {hint && <div style={{ fontSize: "11px", color: GRAY, marginTop: "3px" }}>{hint}</div>}
    </div>
  );
}

// ── メニューエディタ ───────────────────────────────────────────────────────
function MenuItemsEditor({ items, onChange }: { items: MenuItemDraft[]; onChange: (v: MenuItemDraft[]) => void }) {
  const add = () => onChange([...items, { name: "", category: "", price: "", description: "", image_url: "" }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const upd = (i: number, f: keyof MenuItemDraft, v: string) => {
    const next = [...items]; next[i] = { ...next[i], [f]: v }; onChange(next);
  };
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {items.map((m, i) => (
        <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: "10px", padding: "10px", background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: GRAY }}>メニュー #{i + 1}</span>
            <button onClick={() => remove(i)} style={css.btnDanger}>削除</button>
          </div>
          <div style={{ display: "grid", gap: "6px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "6px" }}>
              <input value={m.name} onChange={(e) => upd(i, "name", e.target.value)} style={css.input} placeholder="メニュー名" />
              <input value={m.price} onChange={(e) => upd(i, "price", e.target.value)} style={css.input} placeholder="¥1,200" />
            </div>
            <input value={m.category} onChange={(e) => upd(i, "category", e.target.value)} style={css.input} placeholder="カテゴリ（例: ドリンク / フード）任意" />
            <textarea value={m.description} onChange={(e) => upd(i, "description", e.target.value)} rows={2} style={css.textarea} placeholder="説明（任意）" />
            <input value={m.image_url} onChange={(e) => upd(i, "image_url", e.target.value)} style={css.input} placeholder="画像URL（任意）" />
          </div>
        </div>
      ))}
      <button onClick={add} style={{ ...css.btnSecondary, width: "100%", justifyContent: "center", display: "flex" }}>＋ メニューを追加</button>
    </div>
  );
}

// ── 期間限定イベントエディタ ─────────────────────────────────────────────────
function EventsEditor({ events, onChange }: { events: EventDraft[]; onChange: (v: EventDraft[]) => void }) {
  const add = () => onChange([...events, { title: "", start_date: "", end_date: "", description: "", image_url: "" }]);
  const remove = (i: number) => onChange(events.filter((_, idx) => idx !== i));
  const upd = (i: number, f: keyof EventDraft, v: string) => {
    const next = [...events]; next[i] = { ...next[i], [f]: v }; onChange(next);
  };
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {events.map((ev, i) => (
        <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: "10px", padding: "10px", background: "#fafafa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: GRAY }}>イベント #{i + 1}</span>
            <button onClick={() => remove(i)} style={css.btnDanger}>削除</button>
          </div>
          <div style={{ display: "grid", gap: "6px" }}>
            <input value={ev.title} onChange={(e) => upd(i, "title", e.target.value)} style={css.input} placeholder="イベント名（例: 夏限定かき氷フェア）" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <div>
                <label style={{ ...css.label, fontSize: "11px" }}>開始日</label>
                <input type="date" value={ev.start_date} onChange={(e) => upd(i, "start_date", e.target.value)} style={css.input} />
              </div>
              <div>
                <label style={{ ...css.label, fontSize: "11px" }}>終了日</label>
                <input type="date" value={ev.end_date} onChange={(e) => upd(i, "end_date", e.target.value)} style={css.input} />
              </div>
            </div>
            <textarea value={ev.description} onChange={(e) => upd(i, "description", e.target.value)} rows={2} style={css.textarea} placeholder="説明（任意）" />
            <input value={ev.image_url} onChange={(e) => upd(i, "image_url", e.target.value)} style={css.input} placeholder="画像URL（任意）" />
          </div>
        </div>
      ))}
      <button onClick={add} style={{ ...css.btnSecondary, width: "100%", justifyContent: "center", display: "flex" }}>＋ 期間限定イベントを追加</button>
    </div>
  );
}

// ── 営業時間エディタ ───────────────────────────────────────────────────────
function HoursEditor({ hours, onChange }: { hours: HoursDraft; onChange: (v: HoursDraft) => void }) {
  const updDay = (key: keyof Omit<HoursDraft, "note">, patch: Partial<DayHours>) => {
    onChange({ ...hours, [key]: { ...hours[key], ...patch } });
  };
  return (
    <div style={{ display: "grid", gap: "6px" }}>
      {WEEKDAYS.map(({ key, label }) => {
        const d = hours[key];
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "20px", fontWeight: 700, fontSize: "13px", color: DARK }}>{label}</span>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: GRAY }}>
              <input type="checkbox" checked={d.closed} onChange={(e) => updDay(key, { closed: e.target.checked })} />
              定休
            </label>
            {!d.closed && (
              <>
                <input type="time" value={d.open} onChange={(e) => updDay(key, { open: e.target.value })} style={{ ...css.input, width: "110px", flex: "none" }} />
                <span style={{ color: GRAY }}>〜</span>
                <input type="time" value={d.close} onChange={(e) => updDay(key, { close: e.target.value })} style={{ ...css.input, width: "110px", flex: "none" }} />
              </>
            )}
          </div>
        );
      })}
      <div>
        <label style={css.label}>備考（ラストオーダー等・任意）</label>
        <input value={hours.note} onChange={(e) => onChange({ ...hours, note: e.target.value })} style={css.input} placeholder="L.O. 30分前" />
      </div>
    </div>
  );
}

function SpotEditor({ spots, onChange }: {
  spots: SpotDraft[];
  onChange: (s: SpotDraft[]) => void;
}) {
  const addSpot = () => onChange([...spots, emptySpot()]);

  const removeSpot = (i: number) => onChange(spots.filter((_, idx) => idx !== i));

  const update = (i: number, field: keyof SpotDraft, value: any) => {
    const next = [...spots];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...spots];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      {spots.map((s, i) => (
        <div key={i} style={{ border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", background: "#fafafa" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontWeight: 700, fontSize: "13px", color: DARK }}>#{i + 1} {s.title || "スポット"}</span>
            <div style={{ display: "flex", gap: "4px" }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={css.btnGhost} title="上へ">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === spots.length - 1} style={css.btnGhost} title="下へ">↓</button>
              <button onClick={() => removeSpot(i)} style={css.btnDanger}>削除</button>
            </div>
          </div>

          {/* 画像プレビュー */}
          {s.image_url && (
            <div style={{ marginBottom: "10px" }}>
              <img
                src={s.image_url}
                alt="preview"
                style={{ width: "100%", maxHeight: "140px", objectFit: "cover", borderRadius: "10px", border: `1px solid ${BORDER}` }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}

          <div style={{ display: "grid", gap: "10px" }}>
            {/* 基本 */}
            <div style={{ display: "grid", gap: "8px" }}>
              <div>
                <label style={css.label}>記事見出し（大きく出る名前）*</label>
                <input value={s.title} onChange={(e) => update(i, "title", e.target.value)} style={css.input} placeholder="雨音に包まれるカフェ時間" />
              </div>
              <div>
                <label style={css.label}>店名（正式名称）</label>
                <input value={s.shop_name} onChange={(e) => update(i, "shop_name", e.target.value)} style={css.input} placeholder="喫茶 木漏れ日" />
              </div>
              <div>
                <label style={css.label}>エリア・場所</label>
                <input value={s.location} onChange={(e) => update(i, "location", e.target.value)} style={css.input} placeholder="横浜・元町エリア" />
              </div>
              <div>
                <label style={css.label}>キャッチコピー</label>
                <input value={s.catch_copy} onChange={(e) => update(i, "catch_copy", e.target.value)} style={css.input} placeholder="しっとり静かなひとり時間" />
              </div>
              <div>
                <label style={css.label}>説明文</label>
                <textarea value={s.description} onChange={(e) => update(i, "description", e.target.value)} rows={2} style={css.textarea} placeholder="静かなカフェで、自分だけのリセット時間を。" />
              </div>
              <div>
                <label style={css.label}>サムネイル画像URL（カバー）</label>
                <input value={s.image_url} onChange={(e) => update(i, "image_url", e.target.value)} style={css.input} placeholder="https://images.unsplash.com/..." />
                <div style={{ fontSize: "11px", color: GRAY, marginTop: "3px" }}>Unsplash / Supabase Storage URL など</div>
              </div>
            </div>

            {/* 🍽 メニュー */}
            <SubSection title="🍽 メニュー" hint={s.menu_items.length ? `${s.menu_items.length}件` : "未設定"} defaultOpen>
              <MenuItemsEditor items={s.menu_items} onChange={(v) => update(i, "menu_items", v)} />
            </SubSection>

            {/* 🎪 期間限定イベント */}
            <SubSection title="🎪 期間限定イベント" hint={s.events.length ? `${s.events.length}件` : "未設定"} defaultOpen>
              <EventsEditor events={s.events} onChange={(v) => update(i, "events", v)} />
            </SubSection>

            {/* 🕐 営業時間・定休日 */}
            <SubSection title="🕐 営業時間・定休日" defaultOpen>
              <HoursEditor hours={s.hours} onChange={(v) => update(i, "hours", v)} />
              <div style={{ marginTop: "8px" }}>
                <label style={css.label}>定休日（自由文・任意）</label>
                <input value={s.closed_days} onChange={(e) => update(i, "closed_days", e.target.value)} style={css.input} placeholder="毎週水曜・年末年始" />
              </div>
            </SubSection>

            {/* 🏷 タグ・特徴・ギャラリー */}
            <SubSection title="🏷 タグ・特徴・ギャラリー">
              <div style={{ display: "grid", gap: "10px" }}>
                <LinesField label="タグ（1行に1つ）" value={s.tags} onChange={(v) => update(i, "tags", v)} placeholder={"雨の日OK\nひとり歓迎"} />
                <LinesField label="特徴（1行に1つ）" value={s.features} onChange={(v) => update(i, "features", v)} placeholder={"全席禁煙\nWi-Fiあり\n電源席あり"} />
                <LinesField label="ギャラリー画像URL（1行に1つ）" value={s.gallery_image_urls} onChange={(v) => update(i, "gallery_image_urls", v)} placeholder={"https://...\nhttps://..."} />
              </div>
            </SubSection>

            {/* ℹ 情報・リンク */}
            <SubSection title="ℹ 情報・リンク">
              <div style={{ display: "grid", gap: "8px" }}>
                <div><label style={css.label}>住所</label><input value={s.address} onChange={(e) => update(i, "address", e.target.value)} style={css.input} placeholder="神奈川県横浜市..." /></div>
                <div><label style={css.label}>アクセス</label><input value={s.access} onChange={(e) => update(i, "access", e.target.value)} style={css.input} placeholder="元町・中華街駅から徒歩5分" /></div>
                <div><label style={css.label}>電話</label><input value={s.phone} onChange={(e) => update(i, "phone", e.target.value)} style={css.input} placeholder="045-XXX-XXXX" /></div>
                <div><label style={css.label}>混雑情報</label><input value={s.congestion_info} onChange={(e) => update(i, "congestion_info", e.target.value)} style={css.input} placeholder="土日午後は混雑" /></div>
                <div><label style={css.label}>公式サイトURL</label><input value={s.website} onChange={(e) => update(i, "website", e.target.value)} style={css.input} placeholder="https://..." /></div>
                <div><label style={css.label}>Instagram URL</label><input value={s.instagram} onChange={(e) => update(i, "instagram", e.target.value)} style={css.input} placeholder="https://instagram.com/..." /></div>
              </div>
            </SubSection>
          </div>
        </div>
      ))}

      <button onClick={addSpot} style={{ ...css.btnSecondary, width: "100%", justifyContent: "center", display: "flex" }}>
        ＋ スポットを追加
      </button>
    </div>
  );
}

// ─── 県一覧サイドバー ──────────────────────────────────────────────────────

function PrefSidebar({ pages, selectedId, onSelect, onNew }: {
  pages: PageListItem[];
  selectedId: string | null;
  onSelect: (p: PageListItem) => void;
  onNew: (pref: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const existingPrefs = new Set(pages.map((p) => p.prefecture));
  const available = PREFECTURES.filter((p) => !existingPrefs.has(p));

  return (
    <div style={{ ...css.card, position: "sticky", top: "80px" }}>
      {/* 既存ページ */}
      <div style={{ padding: "14px 16px 8px", borderBottom: `1px solid ${BORDER}` }}>
        <div style={css.secLabel}>作成済み ({pages.length})</div>
      </div>
      <div style={{ maxHeight: "420px", overflowY: "auto" }}>
        {pages.length === 0 ? (
          <div style={{ padding: "20px 16px", color: GRAY, fontSize: "13px", textAlign: "center" }}>まだありません</div>
        ) : (
          pages.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              style={{
                width: "100%", textAlign: "left", padding: "11px 16px",
                background: selectedId === p.id ? "#fce8f0" : "transparent",
                border: "none", borderBottom: `1px solid ${BORDER}`, cursor: "pointer",
                borderLeft: selectedId === p.id ? `3px solid ${PINK}` : "3px solid transparent",
                transition: "background 0.15s",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "13px", color: selectedId === p.id ? PINK : DARK }}>
                {p.prefecture}
              </div>
              <div style={{ fontSize: "11px", color: GRAY, marginTop: "2px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <span>{p.issue}</span>
                <span>気分×{p.featured_page_moods?.length ?? 0}</span>
                <span>スポット×{p.featured_page_spots?.length ?? 0}</span>
                {/* 掲載位置バッジ */}
                <span style={{ background: "#f3eaff", color: "#7c3aed", borderRadius: "999px", padding: "1px 7px", fontWeight: 700 }}>
                  {SLOT_LABEL[p.slot_type ?? "normal"] ?? p.slot_type}
                </span>
                {/* 公開状態バッジ（is_active × 公開期間） */}
                {(() => { const st = publishStatus(p); return (
                  <span style={{ background: st.bg, color: st.color, borderRadius: "999px", padding: "1px 7px", fontWeight: 700 }}>{st.label}</span>
                ); })()}
              </div>
              <div style={{ fontSize: "10px", color: "#aaa", marginTop: "2px" }}>
                更新: {fmtDate(p.updated_at)}
              </div>
            </button>
          ))
        )}
      </div>

      {/* 新規作成 */}
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${BORDER}` }}>
        <div style={css.secLabel}>新規作成</div>
        <select
          defaultValue=""
          onChange={(e) => { if (e.target.value) { onNew(e.target.value); e.target.value = ""; } }}
          style={{ ...css.select, fontSize: "13px" }}
        >
          <option value="" disabled>県を選択...</option>
          {(showAll ? PREFECTURES : available).map((p) => (
            <option key={p} value={p}>{p}{existingPrefs.has(p) ? " (既存)" : ""}</option>
          ))}
        </select>
        {available.length < PREFECTURES.length && (
          <button onClick={() => setShowAll(!showAll)} style={{ ...css.btnGhost, fontSize: "11px", marginTop: "4px", padding: "3px 6px" }}>
            {showAll ? "未作成のみ表示" : "すべて表示"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── エディター本体 ────────────────────────────────────────────────────────

type EditorSection = "banner" | "moods" | "spots";

function Editor({ draft, onChange, onSave, onDelete, saving, saved, error }: {
  draft: PageDraft;
  onChange: (d: PageDraft) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  saved: boolean;
  error: string;
}) {
  const [section, setSection] = useState<EditorSection>("banner");

  const set = (field: keyof PageDraft, value: any) =>
    onChange({ ...draft, [field]: value });

  const sections: { key: EditorSection; label: string; count?: number }[] = [
    { key: "banner", label: "📰 バナー" },
    { key: "moods", label: "❤️ 気分カード", count: draft.moods.length },
    { key: "spots", label: "📍 スポット", count: draft.spots.length },
  ];

  return (
    <div style={css.card}>
      {/* ヘッダー */}
      <div style={{ padding: "18px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: 800, color: DARK }}>
            {draft.prefecture} の特集ページ
          </div>
          <div style={{ fontSize: "12px", color: GRAY, marginTop: "2px" }}>
            {draft.id ? `ID: ${draft.id}` : "新規作成（まだ保存されていません）"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* 公開/非公開 */}
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: DARK }}>
            <div
              onClick={() => set("is_active", !draft.is_active)}
              style={{
                width: "40px", height: "22px", borderRadius: "11px",
                background: draft.is_active ? "#22c55e" : "#d1d5db",
                position: "relative", cursor: "pointer", transition: "background 0.2s",
              }}
            >
              <div style={{
                position: "absolute", top: "2px",
                left: draft.is_active ? "20px" : "2px",
                width: "18px", height: "18px", borderRadius: "50%",
                background: "#fff", transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </div>
            {draft.is_active ? "公開中" : "非公開"}
          </label>

          {/* 削除ボタン */}
          {draft.id && (
            <button onClick={onDelete} style={{ ...css.btnDanger, padding: "8px 14px" }}>
              🗑 削除
            </button>
          )}

          {/* 保存ボタン */}
          <button onClick={onSave} disabled={saving} style={{ ...css.btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? "保存中..." : saved ? "✓ 保存完了" : "💾 保存する"}
          </button>
        </div>
      </div>

      {/* エラー */}
      {error && (
        <div style={{ padding: "12px 20px", background: "#fef2f2", color: "#dc2626", fontSize: "13px", borderBottom: `1px solid #fecaca` }}>
          ⚠ {error}
        </div>
      )}

      {/* 保存完了 */}
      {saved && !saving && (
        <div style={{ padding: "10px 20px", background: "#f0fdf4", color: "#16a34a", fontSize: "13px", borderBottom: `1px solid #bbf7d0` }}>
          ✓ 保存しました！
        </div>
      )}

      {/* タブ切り替え */}
      <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}` }}>
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            style={{
              padding: "12px 20px", border: "none", cursor: "pointer", fontWeight: 700,
              fontSize: "13px", background: "transparent",
              color: section === s.key ? PINK : GRAY,
              borderBottom: section === s.key ? `2px solid ${PINK}` : "2px solid transparent",
              transition: "color 0.15s",
            }}
          >
            {s.label}
            {s.count !== undefined && (
              <span style={{ marginLeft: "5px", background: section === s.key ? PINK : "#e5e7eb", color: section === s.key ? "#fff" : GRAY, borderRadius: "999px", padding: "1px 7px", fontSize: "11px" }}>
                {s.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div style={{ padding: "20px" }}>

        {/* ── バナー ── */}
        {section === "banner" && (
          <div style={{ display: "grid", gap: "16px" }}>
            {/* 画像プレビュー */}
            {draft.banner_image_url && (
              <div style={{ borderRadius: "14px", overflow: "hidden", height: "180px" }}>
                <img
                  src={draft.banner_image_url}
                  alt="banner preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={css.label}>号数 <span style={{ color: PINK }}>*</span></label>
                <input value={draft.issue} onChange={(e) => set("issue", e.target.value)} style={css.input} placeholder="6月号" />
              </div>
              <div>
                <label style={css.label}>ラベル</label>
                <input value={draft.label} onChange={(e) => set("label", e.target.value)} style={css.input} placeholder="今月の特集" />
              </div>
            </div>

            <div>
              <label style={css.label}>バナータイトル <span style={{ color: PINK }}>*</span></label>
              <textarea
                value={draft.banner_title}
                onChange={(e) => set("banner_title", e.target.value)}
                rows={2}
                style={css.textarea}
                placeholder={"雨の日でも\n気分が下がらない横浜"}
              />
              <div style={{ fontSize: "11px", color: GRAY, marginTop: "3px" }}>改行（Shift+Enter）でアプリ内でも改行されます</div>
            </div>

            <div>
              <label style={css.label}>バナー説明文</label>
              <textarea
                value={draft.banner_description}
                onChange={(e) => set("banner_description", e.target.value)}
                rows={2}
                style={css.textarea}
                placeholder={"しっとりした空気の中で、\n心がふっと軽くなる場所へ。"}
              />
            </div>

            <div>
              <label style={css.label}>バナー画像URL</label>
              <input
                value={draft.banner_image_url}
                onChange={(e) => set("banner_image_url", e.target.value)}
                style={css.input}
                placeholder="https://images.unsplash.com/photo-xxx"
              />
              <div style={{ fontSize: "11px", color: GRAY, marginTop: "3px" }}>
                推奨: 横長画像 (16:9 or 4:3)、最低 800px幅
              </div>
            </div>

            <div>
              <label style={css.label}>バナーアイコン (Feather名)</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={draft.banner_icon}
                  onChange={(e) => set("banner_icon", e.target.value)}
                  style={{ ...css.select, flex: 1 }}
                >
                  {FEATHER_ICONS.map((ic) => (
                    <option key={ic} value={ic}>{ic}</option>
                  ))}
                </select>
                <input
                  value={draft.banner_icon}
                  onChange={(e) => set("banner_icon", e.target.value)}
                  style={{ ...css.input, flex: 1 }}
                  placeholder="カスタム入力"
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={css.label}>表示順（小さいほど上）</label>
                <input
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) => set("sort_order", Number(e.target.value))}
                  style={css.input}
                  min={0}
                />
              </div>
              <div>
                <label style={css.label}>都道府県</label>
                <select
                  value={draft.prefecture}
                  onChange={(e) => onChange({
                    ...draft,
                    prefecture: e.target.value,
                    // 対象範囲が「都道府県」のとき scope_key を同期
                    scope_key: draft.scope_type === "prefecture" ? e.target.value : draft.scope_key,
                  })}
                  style={css.select}
                >
                  {PREFECTURES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── 対象範囲・掲載位置・公開期間 ── */}
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "14px", background: BG, display: "grid", gap: "12px" }}>
              <div style={{ fontSize: "13px", fontWeight: 800, color: DARK }}>📌 表示先・掲載位置・公開期間</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={css.label}>対象範囲</label>
                  <select
                    value={draft.scope_type}
                    onChange={(e) => {
                      const st = e.target.value;
                      const key = st === "nationwide" ? "全国"
                        : st === "region" ? (REGIONS.includes(draft.scope_key) ? draft.scope_key : "関東")
                        : draft.prefecture;
                      onChange({ ...draft, scope_type: st, scope_key: key });
                    }}
                    style={css.select}
                  >
                    <option value="prefecture">都道府県</option>
                    <option value="region">地方</option>
                    <option value="nationwide">全国</option>
                  </select>
                </div>
                <div>
                  <label style={css.label}>範囲キー (scope_key)</label>
                  {draft.scope_type === "region" ? (
                    <select
                      value={draft.scope_key}
                      onChange={(e) => onChange({ ...draft, scope_key: e.target.value })}
                      style={css.select}
                    >
                      {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <input value={draft.scope_key} readOnly style={{ ...css.input, background: "#f3f4f6", color: GRAY }} />
                  )}
                  <div style={{ fontSize: "11px", color: GRAY, marginTop: "3px" }}>
                    {draft.scope_type === "prefecture" ? "都道府県セレクトと自動同期します"
                      : draft.scope_type === "nationwide" ? "全国は固定です" : "表示する地方を選択"}
                  </div>
                </div>
              </div>
              <div>
                <label style={css.label}>掲載位置</label>
                <select
                  value={draft.slot_type}
                  onChange={(e) => set("slot_type", e.target.value)}
                  style={css.select}
                >
                  {SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div style={{ fontSize: "11px", color: GRAY, marginTop: "3px" }}>
                  hero/sub_1/sub_2 は同一範囲内で1件ずつが基本です（重複時は保存前に確認します）
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={css.label}>公開開始</label>
                  <input type="datetime-local" value={draft.publish_start}
                    onChange={(e) => set("publish_start", e.target.value)} style={css.input} />
                </div>
                <div>
                  <label style={css.label}>公開終了</label>
                  <input type="datetime-local" value={draft.publish_end}
                    onChange={(e) => set("publish_end", e.target.value)} style={css.input} />
                </div>
              </div>
              <div style={{ fontSize: "11px", color: GRAY }}>
                空欄=制限なし。「公開中トグル」と併用され、両方を満たす期間だけアプリに表示されます。
              </div>
            </div>
          </div>
        )}

        {/* ── 気分カード ── */}
        {section === "moods" && (
          <MoodEditor moods={draft.moods} onChange={(m) => onChange({ ...draft, moods: m })} />
        )}

        {/* ── スポット ── */}
        {section === "spots" && (
          <SpotEditor spots={draft.spots} onChange={(s) => onChange({ ...draft, spots: s })} />
        )}
      </div>

      {/* フッターの保存ボタン（スクロール後も使いやすい） */}
      <div style={{ padding: "16px 20px", borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button onClick={onSave} disabled={saving} style={{ ...css.btnPrimary, opacity: saving ? 0.7 : 1 }}>
          {saving ? "保存中..." : "💾 保存する"}
        </button>
      </div>
    </div>
  );
}

// ─── メインコンポーネント ──────────────────────────────────────────────────

export default function FeaturedPagesAdmin() {
  // 認証は /admin の一度きり。共有シークレット(localStorage["moodgo-admin-secret"])を読むだけで
  //   パスワードを再要求せず、未ログインなら共通ログイン(/admin)へ送る。
  const [authed, setAuthed] = useState(false);
  const [secret, setSecret] = useState("");
  useEffect(() => {
    try {
      const s = localStorage.getItem("moodgo-admin-secret");
      if (s) { setSecret(s); setAuthed(true); }
      else { window.location.replace("/admin"); }
    } catch { window.location.replace("/admin"); }
  }, []);

  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ── データ読み込み ─────────────────────────────────────────────────────
  const loadPages = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/featured-pages?secret=${secret}`);
    const json = await res.json();
    setPages(json.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (authed) loadPages();
  }, [authed]);

  // ── 既存ページを選択してエディターを開く ──────────────────────────────
  const selectPage = async (p: PageListItem) => {
    setSelectedId(p.id);
    setSaved(false);
    setSaveError("");

    const res = await fetch(`/api/admin/featured-pages/${p.id}?secret=${secret}`);
    const json = await res.json();
    const d = json.data;
    if (!d) return;

    setDraft({
      id: d.id,
      prefecture: d.prefecture,
      issue: d.issue,
      label: d.label,
      banner_title: d.banner_title,
      banner_description: d.banner_description ?? "",
      banner_image_url: d.banner_image_url ?? "",
      banner_icon: d.banner_icon ?? "umbrella",
      is_active: d.is_active,
      sort_order: d.sort_order ?? 0,
      // 旧行（マイグレーション前）は prefecture からフォールバック
      scope_type: d.scope_type ?? (d.prefecture === "全国" ? "nationwide" : "prefecture"),
      scope_key: d.scope_key || d.prefecture || "",
      slot_type: d.slot_type ?? "normal",
      publish_start: isoToLocalInput(d.publish_start),
      publish_end: isoToLocalInput(d.publish_end),
      moods: (d.featured_page_moods ?? []).map((m: any) => ({
        title: m.title, icon_name: m.icon_name, icon_color: m.icon_color, bg_color: m.bg_color,
      })),
      spots: (d.featured_page_spots ?? []).map((s: any) => normalizeSpot(s)),
    });
  };

  // ── 新規作成 ────────────────────────────────────────────────────────────
  const createNew = (pref: string) => {
    setSelectedId(null);
    setSaved(false);
    setSaveError("");
    setDraft(emptyDraft(pref));
  };

  // ── 保存 ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!draft) return;
    if (!draft.banner_title.trim()) { setSaveError("バナータイトルは必須です"); return; }

    // hero / sub_1 / sub_2 の同一scope内重複警告（ブロックはせず confirm で確認のみ）
    if (["hero", "sub_1", "sub_2"].includes(draft.slot_type)) {
      const dup = pages.filter((p) =>
        p.id !== draft.id &&
        (p.scope_key || p.prefecture) === draft.scope_key &&
        (p.slot_type ?? "") === draft.slot_type
      );
      if (dup.length > 0) {
        const label = SLOT_LABEL[draft.slot_type] ?? draft.slot_type;
        const ok = confirm(
          `「${draft.scope_key}」には既に 掲載位置=${label}（${draft.slot_type}）のページが${dup.length}件あります（${dup.map((p) => p.prefecture).join("、")}）。\n` +
          `同じ位置が複数になりますが、このまま保存しますか？`
        );
        if (!ok) return;
      }
    }

    // datetime-local → ISO（空=null）に変換して送信
    const body = {
      ...draft,
      publish_start: localInputToIso(draft.publish_start),
      publish_end: localInputToIso(draft.publish_end),
      secret,
    };

    setSaving(true);
    setSaved(false);
    setSaveError("");

    try {
      if (draft.id) {
        // 更新
        const res = await fetch(`/api/admin/featured-pages/${draft.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "保存失敗");
      } else {
        // 新規
        const res = await fetch("/api/admin/featured-pages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "保存失敗");
        setDraft((d) => d ? { ...d, id: json.data.id } : d);
        setSelectedId(json.data.id);
      }

      setSaved(true);
      await loadPages(); // 一覧を再取得
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── 削除 ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!draft?.id) return;
    if (!confirm(`「${draft.prefecture}」の特集ページを削除しますか？\nこの操作は取り消せません。`)) return;

    const res = await fetch(`/api/admin/featured-pages/${draft.id}?secret=${secret}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setDraft(null);
      setSelectedId(null);
      await loadPages();
    } else {
      alert("削除に失敗しました");
    }
  };

  // 認証確認中/未ログインのリダイレクト中は空表示（このページ自身はパスワードを出さない）。
  if (!authed) return null;

  // ── メイン画面 ─────────────────────────────────────────────────────────
  return (
    <div style={css.page}>
      {/* ヘッダー */}
      <div style={css.header}>
        <a href="/admin" style={{ color: GRAY, textDecoration: "none", fontSize: "13px" }}>← 管理画面</a>
        <span style={{ color: "#ccc" }}>/</span>
        <span style={css.headerTitle}>🗺️ 県別 特集ページ管理</span>
        <a href="/admin/popular-areas" style={{ fontSize: "12px", color: PINK, fontWeight: 700, textDecoration: "none" }}>
          🗺 人気エリア管理 →
        </a>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
          {loading && <span style={{ fontSize: "12px", color: GRAY }}>読み込み中...</span>}
          <span style={{ fontSize: "12px", color: GRAY }}>{pages.length}件のページ</span>
          <button onClick={loadPages} style={css.btnSecondary}>🔄 更新</button>
        </div>
      </div>

      <div style={css.body}>
        {/* SQLマイグレーション案内 */}
        {pages.length === 0 && !loading && (
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px", fontSize: "13px", color: "#92400e" }}>
            <strong>⚠ 初回セットアップ：</strong> まずSupabaseのSQL Editorで下記のSQLを実行してください。
            <details style={{ marginTop: "8px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>SQLを表示する</summary>
              <pre style={{ background: "#1e1e1e", color: "#d4d4d4", borderRadius: "8px", padding: "16px", marginTop: "10px", fontSize: "12px", overflowX: "auto", whiteSpace: "pre-wrap" }}>
{`-- 1. 特集ページ（バナー）テーブル
CREATE TABLE IF NOT EXISTS featured_pages_v2 (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefecture    text NOT NULL,
  issue         text NOT NULL DEFAULT '6月号',
  label         text NOT NULL DEFAULT '今月の特集',
  banner_title  text NOT NULL DEFAULT '',
  banner_description text DEFAULT '',
  banner_image_url   text DEFAULT '',
  banner_icon        text DEFAULT 'umbrella',
  is_active     boolean DEFAULT true,
  sort_order    int DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- 2. 気分カードテーブル
CREATE TABLE IF NOT EXISTS featured_page_moods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id    uuid NOT NULL REFERENCES featured_pages_v2(id) ON DELETE CASCADE,
  title      text NOT NULL,
  icon_name  text NOT NULL DEFAULT 'heart',
  icon_color text NOT NULL DEFAULT '#E56B9B',
  bg_color   text NOT NULL DEFAULT '#FCE8F0',
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. おすすめスポットテーブル
CREATE TABLE IF NOT EXISTS featured_page_spots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id     uuid NOT NULL REFERENCES featured_pages_v2(id) ON DELETE CASCADE,
  title       text NOT NULL,
  location    text DEFAULT '',
  description text DEFAULT '',
  image_url   text DEFAULT '',
  sort_order  int DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

-- 4. 対象範囲(scope)・掲載位置(slot)・公開期間 ＋ 人気エリア
--    ※ 完全版（既存行の移行UPDATE・インデックス・初期データ投入を含む）は
--      リポジトリの supabase/featured-scope-placement.sql を実行してください。
ALTER TABLE featured_pages_v2
  -- 対象範囲: prefecture(都道府県) / region(地方) / nationwide(全国)
  ADD COLUMN IF NOT EXISTS scope_type    text        DEFAULT 'prefecture',
  -- 範囲キー（日本語）: 神奈川県 等 / 関東 等 / 全国
  ADD COLUMN IF NOT EXISTS scope_key     text        DEFAULT '',
  -- 掲載位置: hero(メイン) / sub_1(サブ左) / sub_2(サブ右) / normal(通常) / hidden(TOP非表示)
  ADD COLUMN IF NOT EXISTS slot_type     text        DEFAULT 'normal',
  -- 公開期間（NULL=制限なし）。is_active と併用
  ADD COLUMN IF NOT EXISTS publish_start timestamptz,
  ADD COLUMN IF NOT EXISTS publish_end   timestamptz;

-- 5. 人気エリア（特集TOPの横スクロールカード、/admin/popular-areas で管理）
--    完全なCREATE TABLE・初期データは supabase/featured-scope-placement.sql を参照

-- RLS は SUPABASE_SERVICE_KEY 使用のためサーバー側で管理
-- 必要に応じて Row Level Security を設定してください`}
              </pre>
              <button
                onClick={() => navigator.clipboard.writeText(`CREATE TABLE IF NOT EXISTS featured_pages_v2 (...`)}
                style={{ ...css.btnSecondary, fontSize: "12px", marginTop: "8px" }}
              >
                📋 コピー
              </button>
            </details>
          </div>
        )}

        <div style={css.cols}>
          {/* サイドバー */}
          <PrefSidebar
            pages={pages}
            selectedId={selectedId}
            onSelect={selectPage}
            onNew={createNew}
          />

          {/* エディター */}
          <div>
            {draft ? (
              <Editor
                draft={draft}
                onChange={setDraft}
                onSave={handleSave}
                onDelete={handleDelete}
                saving={saving}
                saved={saved}
                error={saveError}
              />
            ) : (
              <div style={{ ...css.card, ...css.cardPad, textAlign: "center", padding: "60px 40px" }}>
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>🗾</div>
                <div style={{ fontSize: "18px", fontWeight: 700, color: DARK, marginBottom: "8px" }}>
                  都道府県を選択してください
                </div>
                <div style={{ fontSize: "13px", color: GRAY, marginBottom: "24px" }}>
                  左のサイドバーから既存の特集ページを選ぶか、<br />
                  新規作成から県を選んでページを作成してください。
                </div>
                <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
                  {["東京都", "神奈川県", "大阪府", "全国"].map((p) => (
                    <button key={p} onClick={() => createNew(p)} style={css.btnSecondary}>
                      + {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
