"use client";
// ── 県別特集ページ管理パネル ─────────────────────────────────────────────────
// 既存管理ダッシュボードの1タブとして組み込まれるコンポーネント

import { useEffect, useState } from "react";

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface PageListItem {
  id: string;
  prefecture: string;
  issue: string;
  is_active: boolean;
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

interface SpotDraft {
  title: string;
  location: string;
  description: string;
  image_url: string;
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
  moods: MoodDraft[];
  spots: SpotDraft[];
}

// ─── 定数 ──────────────────────────────────────────────────────────────────

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

const FEATHER_ICONS = [
  "umbrella", "star", "heart", "sun", "cloud", "map-pin", "coffee",
  "camera", "music", "compass", "zap", "smile", "moon", "wind",
  "anchor", "activity", "award", "bookmark", "truck",
];

const IONICONS_LIST = [
  "body", "chatbubble-ellipses", "cloudy", "heart", "star", "cafe",
  "car", "book", "bicycle", "fitness", "airplane", "restaurant",
  "camera", "musical-notes", "walk", "leaf", "flash", "globe", "home", "people",
];

const PRESET_ICON_COLORS = [
  { color: "#E56B9B", label: "ピンク" }, { color: "#9B5ED4", label: "パープル" },
  { color: "#D98C30", label: "オレンジ" }, { color: "#4D84C4", label: "ブルー" },
  { color: "#3DAA6E", label: "グリーン" }, { color: "#C44D4D", label: "レッド" },
];

const PRESET_BG_COLORS = [
  { color: "#FCE8F0", label: "ピンク" }, { color: "#F3EAFF", label: "パープル" },
  { color: "#FFF4E3", label: "オレンジ" }, { color: "#E8F1FF", label: "ブルー" },
  { color: "#E8F5EE", label: "グリーン" }, { color: "#FFECEC", label: "レッド" },
];

const SQL_MIGRATION = `-- 1. 特集ページ（バナー）テーブル
CREATE TABLE IF NOT EXISTS featured_pages_v2 (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefecture         text NOT NULL,
  issue              text NOT NULL DEFAULT '6月号',
  label              text NOT NULL DEFAULT '今月の特集',
  banner_title       text NOT NULL DEFAULT '',
  banner_description text DEFAULT '',
  banner_image_url   text DEFAULT '',
  banner_icon        text DEFAULT 'umbrella',
  is_active          boolean DEFAULT true,
  sort_order         int DEFAULT 0,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
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
);`;

// ─── ユーティリティ ─────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("ja-JP", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function emptyDraft(prefecture = ""): PageDraft {
  return {
    id: null, prefecture, issue: "6月号", label: "今月の特集",
    banner_title: "", banner_description: "", banner_image_url: "",
    banner_icon: "umbrella", is_active: true, sort_order: 0,
    moods: [
      { title: "ひとりで\n整いたい",   icon_name: "body",                 icon_color: "#9B5ED4", bg_color: "#F3EAFF" },
      { title: "友達と\n話したい夜",   icon_name: "chatbubble-ellipses",  icon_color: "#D98C30", bg_color: "#FFF4E3" },
      { title: "雨の日でも\n楽しめる", icon_name: "cloudy",               icon_color: "#4D84C4", bg_color: "#E8F1FF" },
    ],
    spots: [],
  };
}

// ─── スタイル ───────────────────────────────────────────────────────────────

// 既存adminページのスタイルに合わせたパレット
const C = {
  pink:    "#ff8f7f",
  dark:    "#4a3034",
  gray:    "#9b7b82",
  border:  "#ead7db",
  bg:      "#fff5f7",
  card:    "#ffffff",
  green:   "#18794e",
  red:     "#c0385a",
};

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1.5px solid ${C.border}`,
  borderRadius: "8px", padding: "8px 12px", fontSize: "13px",
  outline: "none", background: "#fff", color: C.dark,
};
const btn = {
  base: { border: "none", borderRadius: "10px", padding: "9px 18px", fontWeight: 700, fontSize: "13px", cursor: "pointer" } as React.CSSProperties,
  primary: { background: "linear-gradient(135deg,#ffbf67,#ff8f7f)", color: "#fff" } as React.CSSProperties,
  sub: { background: "#fff", color: C.dark, border: `1.5px solid ${C.border}` } as React.CSSProperties,
  danger: { background: "#fff4f4", color: C.red, border: `1.5px solid #fca5a5` } as React.CSSProperties,
  ghost: { background: "transparent", color: C.gray, border: "none", padding: "4px 8px", fontSize: "13px", cursor: "pointer", borderRadius: "6px" } as React.CSSProperties,
};

// ─── カラースウォッチ ──────────────────────────────────────────────────────

function Swatches({ value, options, onChange }: {
  value: string; options: { color: string; label: string }[]; onChange: (c: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
      {options.map((o) => (
        <button key={o.color} title={o.label} onClick={() => onChange(o.color)} style={{
          width: "22px", height: "22px", borderRadius: "50%", cursor: "pointer",
          background: o.color, border: value === o.color ? `3px solid ${C.dark}` : "2px solid #ddd",
        }} />
      ))}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="#RRGGBB" style={{ ...inp, width: "100px", padding: "5px 8px", fontSize: "12px" }} />
    </div>
  );
}

// ─── 気分カードエディター ─────────────────────────────────────────────────

function MoodEditor({ moods, onChange }: { moods: MoodDraft[]; onChange: (m: MoodDraft[]) => void }) {
  const add = () => onChange([...moods, { title: "新しい気分", icon_name: "heart", icon_color: "#E56B9B", bg_color: "#FCE8F0" }]);
  const remove = (i: number) => onChange(moods.filter((_, idx) => idx !== i));
  const upd = (i: number, f: keyof MoodDraft, v: string) => { const n = [...moods]; n[i] = { ...n[i], [f]: v }; onChange(n); };
  const move = (i: number, d: -1 | 1) => { const n = [...moods]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };

  return (
    <div>
      {moods.map((m, i) => (
        <div key={i} style={{ border: `1.5px solid ${C.border}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", background: C.bg }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontWeight: 700, fontSize: "13px", color: C.dark }}>#{i + 1} 気分カード</span>
            <div style={{ display: "flex", gap: "4px" }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={btn.ghost}>↑</button>
              <button onClick={() => move(i, 1)} disabled={i === moods.length - 1} style={btn.ghost}>↓</button>
              <button onClick={() => remove(i)} style={{ ...btn.base, ...btn.danger, padding: "5px 10px", fontSize: "12px" }}>削除</button>
            </div>
          </div>
          <div style={{ display: "grid", gap: "10px" }}>
            {/* テキスト */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>テキスト（改行OK）</label>
              <textarea value={m.title} onChange={(e) => upd(i, "title", e.target.value)}
                rows={2} style={{ ...inp, resize: "vertical" as const }} placeholder={"ひとりで\n整いたい"} />
            </div>
            {/* アイコン */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>アイコン名 (Ionicons)</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <select value={m.icon_name} onChange={(e) => upd(i, "icon_name", e.target.value)} style={{ ...inp }}>
                  {IONICONS_LIST.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                </select>
                <input value={m.icon_name} onChange={(e) => upd(i, "icon_name", e.target.value)} style={inp} placeholder="カスタム入力" />
              </div>
            </div>
            {/* 色 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>アイコン色</label>
                <Swatches value={m.icon_color} options={PRESET_ICON_COLORS} onChange={(c) => upd(i, "icon_color", c)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>背景色</label>
                <Swatches value={m.bg_color} options={PRESET_BG_COLORS} onChange={(c) => upd(i, "bg_color", c)} />
              </div>
            </div>
            {/* プレビュー */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>プレビュー</label>
              <div style={{ display: "inline-flex", flexDirection: "column" as const, alignItems: "center",
                background: m.bg_color, borderRadius: "14px", padding: "14px 18px", gap: "6px", minWidth: "72px" }}>
                <span style={{ fontSize: "22px" }}>◉</span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: m.icon_color, textAlign: "center" as const, whiteSpace: "pre-wrap" as const, lineHeight: "1.4" }}>
                  {m.title}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
      <button onClick={add} style={{ ...btn.base, ...btn.sub, width: "100%", justifyContent: "center", display: "flex" }}>
        ＋ 気分カードを追加
      </button>
    </div>
  );
}

// ─── スポットエディター ────────────────────────────────────────────────────

function SpotEditor({ spots, onChange }: { spots: SpotDraft[]; onChange: (s: SpotDraft[]) => void }) {
  const add = () => onChange([...spots, { title: "", location: "", description: "", image_url: "" }]);
  const remove = (i: number) => onChange(spots.filter((_, idx) => idx !== i));
  const upd = (i: number, f: keyof SpotDraft, v: string) => { const n = [...spots]; n[i] = { ...n[i], [f]: v }; onChange(n); };
  const move = (i: number, d: -1 | 1) => { const n = [...spots]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };

  return (
    <div>
      {spots.map((s, i) => (
        <div key={i} style={{ border: `1.5px solid ${C.border}`, borderRadius: "12px", padding: "14px", marginBottom: "10px", background: C.bg }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontWeight: 700, fontSize: "13px", color: C.dark }}>#{i + 1} スポット</span>
            <div style={{ display: "flex", gap: "4px" }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={btn.ghost}>↑</button>
              <button onClick={() => move(i, 1)} disabled={i === spots.length - 1} style={btn.ghost}>↓</button>
              <button onClick={() => remove(i)} style={{ ...btn.base, ...btn.danger, padding: "5px 10px", fontSize: "12px" }}>削除</button>
            </div>
          </div>
          {/* サムネプレビュー */}
          {s.image_url && (
            <img src={s.image_url} alt="" style={{ width: "100%", maxHeight: "120px", objectFit: "cover" as const, borderRadius: "8px", marginBottom: "10px" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <div style={{ display: "grid", gap: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>スポット名 *</label>
              <input value={s.title} onChange={(e) => upd(i, "title", e.target.value)} style={inp} placeholder="雨音に包まれるカフェ時間" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>エリア・場所</label>
              <input value={s.location} onChange={(e) => upd(i, "location", e.target.value)} style={inp} placeholder="横浜・元町エリア" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>説明文</label>
              <textarea value={s.description} onChange={(e) => upd(i, "description", e.target.value)}
                rows={2} style={{ ...inp, resize: "vertical" as const }} placeholder="静かなカフェで、自分だけのリセット時間を。" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>
                サムネイル画像URL
              </label>
              <input value={s.image_url} onChange={(e) => upd(i, "image_url", e.target.value)} style={inp}
                placeholder="https://images.unsplash.com/..." />
            </div>
          </div>
        </div>
      ))}
      <button onClick={add} style={{ ...btn.base, ...btn.sub, width: "100%", justifyContent: "center", display: "flex" }}>
        ＋ スポットを追加
      </button>
    </div>
  );
}

// ─── メインパネル ──────────────────────────────────────────────────────────

type EditorTab = "banner" | "moods" | "spots";

export default function PrefFeaturedPanel({ secret }: { secret: string }) {
  const [pages, setPages]             = useState<PageListItem[]>([]);
  const [loading, setLoading]         = useState(false);
  const [draft, setDraft]             = useState<PageDraft | null>(null);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [edTab, setEdTab]             = useState<EditorTab>("banner");
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [saveErr, setSaveErr]         = useState("");
  const [showSql, setShowSql]         = useState(false);
  const [showAllPref, setShowAllPref] = useState(false);

  // ── データ取得 ──────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/featured-pages?secret=${secret}`);
      const j = await r.json();
      setPages(j.data ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── ページ選択 ──────────────────────────────────────────────────────────
  const selectPage = async (p: PageListItem) => {
    setSelectedId(p.id);
    setSaved(false); setSaveErr("");
    const r = await fetch(`/api/admin/featured-pages/${p.id}?secret=${secret}`);
    const j = await r.json();
    const d = j.data;
    if (!d) return;
    setDraft({
      id: d.id, prefecture: d.prefecture, issue: d.issue, label: d.label,
      banner_title: d.banner_title, banner_description: d.banner_description ?? "",
      banner_image_url: d.banner_image_url ?? "", banner_icon: d.banner_icon ?? "umbrella",
      is_active: d.is_active, sort_order: d.sort_order ?? 0,
      moods: (d.featured_page_moods ?? []).map((m: any) => ({ title: m.title, icon_name: m.icon_name, icon_color: m.icon_color, bg_color: m.bg_color })),
      spots: (d.featured_page_spots ?? []).map((s: any) => ({ title: s.title, location: s.location ?? "", description: s.description ?? "", image_url: s.image_url ?? "" })),
    });
  };

  // ── 新規作成 ────────────────────────────────────────────────────────────
  const createNew = (pref: string) => {
    setSelectedId(null); setSaved(false); setSaveErr("");
    setDraft(emptyDraft(pref));
    setEdTab("banner");
  };

  // ── 保存 ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!draft) return;
    if (!draft.banner_title.trim()) { setSaveErr("バナータイトルは必須です"); return; }
    setSaving(true); setSaved(false); setSaveErr("");
    try {
      if (draft.id) {
        const r = await fetch(`/api/admin/featured-pages/${draft.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, secret }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "保存失敗");
      } else {
        const r = await fetch("/api/admin/featured-pages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, secret }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "保存失敗");
        setDraft((d) => d ? { ...d, id: j.data.id } : d);
        setSelectedId(j.data.id);
      }
      setSaved(true);
      await load();
    } catch (e: any) { setSaveErr(e.message); }
    finally { setSaving(false); }
  };

  // ── 削除 ────────────────────────────────────────────────────────────────
  const deletePage = async () => {
    if (!draft?.id) return;
    if (!confirm(`「${draft.prefecture}」の特集ページを削除しますか？\n気分カード・スポットも全て削除されます。`)) return;
    const r = await fetch(`/api/admin/featured-pages/${draft.id}?secret=${secret}`, { method: "DELETE" });
    if (r.ok) { setDraft(null); setSelectedId(null); await load(); }
    else alert("削除に失敗しました");
  };

  const existingPrefs = new Set(pages.map((p) => p.prefecture));
  const availablePrefs = PREFECTURES.filter((p) => !existingPrefs.has(p));

  // ── スタイル ────────────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: "#fff", borderRadius: "16px",
    border: `1.5px solid ${C.border}`,
    boxShadow: "0 2px 12px rgba(74,48,52,0.07)", overflow: "hidden",
  };

  const edTabBtn = (key: EditorTab, label: string, count?: number) => (
    <button onClick={() => setEdTab(key)} style={{
      padding: "10px 16px", border: "none", cursor: "pointer", fontWeight: 700,
      fontSize: "13px", background: "transparent",
      color: edTab === key ? C.pink : C.gray,
      borderBottom: edTab === key ? `2.5px solid ${C.pink}` : "2.5px solid transparent",
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          marginLeft: "5px", background: edTab === key ? C.pink : C.border,
          color: edTab === key ? "#fff" : C.gray,
          borderRadius: "999px", padding: "1px 7px", fontSize: "11px",
        }}>{count}</span>
      )}
    </button>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── ヘッダー ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: C.dark }}>🗾 県別 特集ページ管理</div>
          <div style={{ fontSize: "13px", color: C.gray, marginTop: "3px" }}>
            都道府県ごとにアプリの「特集」タブに表示するコンテンツを管理します
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {loading && <span style={{ fontSize: "12px", color: C.gray }}>読み込み中...</span>}
          <button onClick={load} style={{ ...btn.base, ...btn.sub, padding: "8px 16px" }}>🔄 更新</button>
          <button onClick={() => setShowSql(!showSql)} style={{ ...btn.base, ...btn.sub, padding: "8px 16px" }}>
            🗄 初回SQL {showSql ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* ── SQLセットアップ案内 ── */}
      {showSql && (
        <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px" }}>
          <div style={{ fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>
            ⚠ 初回のみ: Supabase SQL Editorで以下を実行してください
          </div>
          <pre style={{ background: "#1e1e1e", color: "#d4d4d4", borderRadius: "8px", padding: "14px", fontSize: "12px", overflowX: "auto", whiteSpace: "pre-wrap" }}>
            {SQL_MIGRATION}
          </pre>
          <button onClick={() => navigator.clipboard.writeText(SQL_MIGRATION)}
            style={{ ...btn.base, ...btn.sub, fontSize: "12px", marginTop: "8px", padding: "6px 14px" }}>
            📋 コピー
          </button>
        </div>
      )}

      {/* ── メイン2カラム ── */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "20px", alignItems: "start" }}>

        {/* ── 左：県一覧 ── */}
        <div style={{ ...cardStyle, position: "sticky", top: "20px" }}>
          {/* 作成済み一覧 */}
          <div style={{ padding: "12px 14px 6px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              作成済み ({pages.length}件)
            </div>
          </div>
          <div style={{ maxHeight: "380px", overflowY: "auto" }}>
            {pages.length === 0 ? (
              <div style={{ padding: "20px 14px", color: C.gray, fontSize: "13px", textAlign: "center" }}>
                まだ特集ページがありません
              </div>
            ) : pages.map((p) => (
              <button key={p.id} onClick={() => selectPage(p)} style={{
                width: "100%", textAlign: "left", padding: "10px 14px", background: selectedId === p.id ? "#fff5f7" : "transparent",
                border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                borderLeft: selectedId === p.id ? `3px solid ${C.pink}` : "3px solid transparent",
              }}>
                <div style={{ fontWeight: 700, fontSize: "13px", color: selectedId === p.id ? C.pink : C.dark }}>
                  {p.prefecture}
                </div>
                <div style={{ fontSize: "11px", color: C.gray, marginTop: "2px", display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
                  <span>{p.issue}</span>
                  <span>気分×{p.featured_page_moods?.length ?? 0}</span>
                  <span>スポット×{p.featured_page_spots?.length ?? 0}</span>
                  <span style={{ background: p.is_active ? "#dcfce7" : "#fee2e2", color: p.is_active ? "#16a34a" : "#dc2626", borderRadius: "999px", padding: "1px 7px" }}>
                    {p.is_active ? "公開" : "非公開"}
                  </span>
                </div>
                <div style={{ fontSize: "10px", color: "#bbb", marginTop: "2px" }}>更新: {fmtDate(p.updated_at)}</div>
              </button>
            ))}
          </div>

          {/* 新規作成 */}
          <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: C.gray, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
              ＋ 新規作成
            </div>
            <select defaultValue="" onChange={(e) => { if (e.target.value) { createNew(e.target.value); (e.target as HTMLSelectElement).value = ""; } }}
              style={{ ...inp, fontSize: "13px" }}>
              <option value="" disabled>都道府県を選択...</option>
              {(showAllPref ? PREFECTURES : availablePrefs).map((p) => (
                <option key={p} value={p}>{p}{existingPrefs.has(p) ? " (既存)" : ""}</option>
              ))}
            </select>
            {availablePrefs.length < PREFECTURES.length && (
              <button onClick={() => setShowAllPref(!showAllPref)}
                style={{ ...btn.ghost, fontSize: "11px", marginTop: "4px", padding: "3px 4px" }}>
                {showAllPref ? "未作成のみ表示" : "既存含む全て表示"}
              </button>
            )}
          </div>
        </div>

        {/* ── 右：エディター ── */}
        {draft ? (
          <div style={cardStyle}>
            {/* エディターヘッダー */}
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <div style={{ fontSize: "17px", fontWeight: 800, color: C.dark }}>
                  {draft.prefecture} の特集ページ
                </div>
                <div style={{ fontSize: "11px", color: C.gray, marginTop: "2px" }}>
                  {draft.id ? `ID: ${draft.id.slice(0, 8)}...` : "新規（未保存）"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {/* 公開/非公開トグル */}
                <label style={{ display: "flex", alignItems: "center", gap: "7px", cursor: "pointer" }}>
                  <div onClick={() => setDraft((d) => d ? { ...d, is_active: !d.is_active } : d)} style={{
                    width: "38px", height: "21px", borderRadius: "999px",
                    background: draft.is_active ? "#22c55e" : "#d1d5db",
                    position: "relative", cursor: "pointer", transition: "background 0.2s",
                  }}>
                    <div style={{
                      position: "absolute", top: "2px", left: draft.is_active ? "18px" : "2px",
                      width: "17px", height: "17px", borderRadius: "50%", background: "#fff",
                      transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                    }} />
                  </div>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: draft.is_active ? C.green : C.gray }}>
                    {draft.is_active ? "公開中" : "非公開"}
                  </span>
                </label>
                {draft.id && (
                  <button onClick={deletePage} style={{ ...btn.base, ...btn.danger, padding: "8px 14px", fontSize: "12px" }}>
                    🗑 削除
                  </button>
                )}
                <button onClick={save} disabled={saving} style={{ ...btn.base, ...btn.primary, opacity: saving ? 0.7 : 1 }}>
                  {saving ? "保存中..." : saved ? "✓ 保存完了" : "💾 保存する"}
                </button>
              </div>
            </div>

            {/* エラー・成功メッセージ */}
            {saveErr && (
              <div style={{ padding: "10px 20px", background: "#fef2f2", color: C.red, fontSize: "13px", borderBottom: `1px solid #fecaca` }}>
                ⚠ {saveErr}
              </div>
            )}
            {saved && !saving && (
              <div style={{ padding: "10px 20px", background: "#f0fdf4", color: C.green, fontSize: "13px", borderBottom: `1px solid #bbf7d0`, fontWeight: 700 }}>
                ✓ 保存しました！
              </div>
            )}

            {/* タブ */}
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
              {edTabBtn("banner", "📰 バナー")}
              {edTabBtn("moods",  "❤️ 気分カード", draft.moods.length)}
              {edTabBtn("spots",  "📍 スポット",   draft.spots.length)}
            </div>

            {/* タブコンテンツ */}
            <div style={{ padding: "20px" }}>
              {/* ── バナー ── */}
              {edTab === "banner" && (
                <div style={{ display: "grid", gap: "16px" }}>
                  {/* バナー画像プレビュー */}
                  {draft.banner_image_url && (
                    <img src={draft.banner_image_url} alt="banner" style={{ width: "100%", height: "160px", objectFit: "cover" as const, borderRadius: "12px", border: `1px solid ${C.border}` }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>
                        号数 <span style={{ color: C.red }}>*</span>
                      </label>
                      <input value={draft.issue} onChange={(e) => setDraft((d) => d ? { ...d, issue: e.target.value } : d)}
                        style={inp} placeholder="6月号" />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>ラベル</label>
                      <input value={draft.label} onChange={(e) => setDraft((d) => d ? { ...d, label: e.target.value } : d)}
                        style={inp} placeholder="今月の特集" />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>
                      バナータイトル <span style={{ color: C.red }}>*</span>
                    </label>
                    <textarea value={draft.banner_title}
                      onChange={(e) => setDraft((d) => d ? { ...d, banner_title: e.target.value } : d)}
                      rows={2} style={{ ...inp, resize: "vertical" as const }}
                      placeholder={"雨の日でも\n気分が下がらない横浜"} />
                    <div style={{ fontSize: "11px", color: C.gray, marginTop: "3px" }}>改行はアプリ内でも反映されます</div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>バナー説明文</label>
                    <textarea value={draft.banner_description}
                      onChange={(e) => setDraft((d) => d ? { ...d, banner_description: e.target.value } : d)}
                      rows={2} style={{ ...inp, resize: "vertical" as const }}
                      placeholder={"しっとりした空気の中で、\n心がふっと軽くなる場所へ。"} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>バナー画像URL</label>
                    <input value={draft.banner_image_url}
                      onChange={(e) => setDraft((d) => d ? { ...d, banner_image_url: e.target.value } : d)}
                      style={inp} placeholder="https://images.unsplash.com/photo-xxx?w=900" />
                    <div style={{ fontSize: "11px", color: C.gray, marginTop: "3px" }}>
                      推奨: 横長 800px以上 (Unsplash / Supabase Storage)
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>バナーアイコン</label>
                      <select value={draft.banner_icon}
                        onChange={(e) => setDraft((d) => d ? { ...d, banner_icon: e.target.value } : d)} style={inp}>
                        {FEATHER_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>都道府県</label>
                      <select value={draft.prefecture}
                        onChange={(e) => setDraft((d) => d ? { ...d, prefecture: e.target.value } : d)} style={inp}>
                        {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" }}>表示順</label>
                      <input type="number" value={draft.sort_order}
                        onChange={(e) => setDraft((d) => d ? { ...d, sort_order: Number(e.target.value) } : d)}
                        style={inp} min={0} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── 気分カード ── */}
              {edTab === "moods" && (
                <MoodEditor moods={draft.moods} onChange={(m) => setDraft((d) => d ? { ...d, moods: m } : d)} />
              )}

              {/* ── スポット ── */}
              {edTab === "spots" && (
                <SpotEditor spots={draft.spots} onChange={(s) => setDraft((d) => d ? { ...d, spots: s } : d)} />
              )}
            </div>

            {/* フッター保存ボタン */}
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button onClick={save} disabled={saving} style={{ ...btn.base, ...btn.primary, opacity: saving ? 0.7 : 1 }}>
                {saving ? "保存中..." : "💾 保存する"}
              </button>
            </div>
          </div>
        ) : (
          /* 未選択時のプレースホルダー */
          <div style={{ ...cardStyle, padding: "60px 40px", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🗾</div>
            <div style={{ fontSize: "17px", fontWeight: 800, color: C.dark, marginBottom: "8px" }}>
              都道府県を選択してください
            </div>
            <div style={{ fontSize: "13px", color: C.gray, marginBottom: "24px", lineHeight: "1.7" }}>
              左のリストから編集したいページを選ぶか、<br />
              「新規作成」から県を選んでページを作成してください。
            </div>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" as const }}>
              {["東京都", "神奈川県", "大阪府", "全国"].map((p) => (
                <button key={p} onClick={() => createNew(p)} style={{ ...btn.base, ...btn.sub, fontSize: "13px" }}>
                  ＋ {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
