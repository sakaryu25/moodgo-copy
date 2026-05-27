"use client";
// ── 県別 特集ページ管理 ─────────────────────────────────────────────────────
// /admin/featured-pages
// バナー / 気分カード / おすすめスポット を県ごとに編集できる管理者ページ

import { useEffect, useRef, useState } from "react";

// ─── 定数 ──────────────────────────────────────────────────────────────────

const ADMIN_SECRET = "moodgoadmin123";

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

function SpotEditor({ spots, onChange }: {
  spots: SpotDraft[];
  onChange: (s: SpotDraft[]) => void;
}) {
  const addSpot = () => onChange([
    ...spots,
    { title: "", location: "", description: "", image_url: "" },
  ]);

  const removeSpot = (i: number) => onChange(spots.filter((_, idx) => idx !== i));

  const update = (i: number, field: keyof SpotDraft, value: string) => {
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
            <span style={{ fontWeight: 700, fontSize: "13px", color: DARK }}>#{i + 1} スポット</span>
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

          <div style={{ display: "grid", gap: "8px" }}>
            <div>
              <label style={css.label}>スポット名 *</label>
              <input value={s.title} onChange={(e) => update(i, "title", e.target.value)} style={css.input} placeholder="雨音に包まれるカフェ時間" />
            </div>
            <div>
              <label style={css.label}>エリア・場所</label>
              <input value={s.location} onChange={(e) => update(i, "location", e.target.value)} style={css.input} placeholder="横浜・元町エリア" />
            </div>
            <div>
              <label style={css.label}>説明文</label>
              <textarea value={s.description} onChange={(e) => update(i, "description", e.target.value)} rows={2} style={css.textarea} placeholder="静かなカフェで、自分だけのリセット時間を。" />
            </div>
            <div>
              <label style={css.label}>サムネイル画像URL</label>
              <input value={s.image_url} onChange={(e) => update(i, "image_url", e.target.value)} style={css.input} placeholder="https://images.unsplash.com/..." />
              <div style={{ fontSize: "11px", color: GRAY, marginTop: "3px" }}>Unsplash / Supabase Storage URL など</div>
            </div>
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
              <div style={{ fontSize: "11px", color: GRAY, marginTop: "2px", display: "flex", gap: "8px" }}>
                <span>{p.issue}</span>
                <span>気分×{p.featured_page_moods?.length ?? 0}</span>
                <span>スポット×{p.featured_page_spots?.length ?? 0}</span>
                <span style={p.is_active ? css.badgeActive : css.badgeInactive}>
                  {p.is_active ? "公開" : "非公開"}
                </span>
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
                  onChange={(e) => set("prefecture", e.target.value)}
                  style={css.select}
                >
                  {PREFECTURES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
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
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);

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
    const res = await fetch(`/api/admin/featured-pages?secret=${ADMIN_SECRET}`);
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

    const res = await fetch(`/api/admin/featured-pages/${p.id}?secret=${ADMIN_SECRET}`);
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
      moods: (d.featured_page_moods ?? []).map((m: any) => ({
        title: m.title, icon_name: m.icon_name, icon_color: m.icon_color, bg_color: m.bg_color,
      })),
      spots: (d.featured_page_spots ?? []).map((s: any) => ({
        title: s.title, location: s.location ?? "", description: s.description ?? "", image_url: s.image_url ?? "",
      })),
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
    setSaving(true);
    setSaved(false);
    setSaveError("");

    try {
      if (draft.id) {
        // 更新
        const res = await fetch(`/api/admin/featured-pages/${draft.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, secret: ADMIN_SECRET }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "保存失敗");
      } else {
        // 新規
        const res = await fetch("/api/admin/featured-pages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, secret: ADMIN_SECRET }),
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

    const res = await fetch(`/api/admin/featured-pages/${draft.id}?secret=${ADMIN_SECRET}`, {
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

  // ── パスワード画面 ─────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div style={{ ...css.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#fff", borderRadius: "20px", padding: "40px 48px", border: `1px solid ${BORDER}`, textAlign: "center", minWidth: "320px" }}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>🗺️</div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: DARK, marginBottom: "4px" }}>特集ページ管理</div>
          <div style={{ fontSize: "13px", color: GRAY, marginBottom: "24px" }}>管理者パスワードを入力してください</div>
          <input
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setPwError(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { setAuthed(pw === ADMIN_SECRET); setPwError(pw !== ADMIN_SECRET); } }}
            placeholder="パスワード"
            style={{ ...css.input, marginBottom: "12px", textAlign: "center", fontSize: "16px" }}
            autoFocus
          />
          {pwError && <div style={{ color: "#dc2626", fontSize: "13px", marginBottom: "10px" }}>パスワードが違います</div>}
          <button
            onClick={() => { setAuthed(pw === ADMIN_SECRET); setPwError(pw !== ADMIN_SECRET); }}
            style={{ ...css.btnPrimary, width: "100%", justifyContent: "center" }}
          >
            ログイン
          </button>
          <div style={{ marginTop: "16px" }}>
            <a href="/admin" style={{ fontSize: "12px", color: GRAY }}>← メイン管理画面へ戻る</a>
          </div>
        </div>
      </div>
    );
  }

  // ── メイン画面 ─────────────────────────────────────────────────────────
  return (
    <div style={css.page}>
      {/* ヘッダー */}
      <div style={css.header}>
        <a href="/admin" style={{ color: GRAY, textDecoration: "none", fontSize: "13px" }}>← 管理画面</a>
        <span style={{ color: "#ccc" }}>/</span>
        <span style={css.headerTitle}>🗺️ 県別 特集ページ管理</span>
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
