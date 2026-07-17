"use client";
// ── 人気エリア管理 ──────────────────────────────────────────────────────────
// /admin/popular-areas
// 特集TOPの横スクロール「人気エリア」カード（popular_areas テーブル）を管理する。
// API: /api/admin/popular-areas（GET ?secret= / POST / PUT / DELETE body.secret）

import { useEffect, useState } from "react";

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface AreaRow {
  id: string;
  name: string;
  description: string;
  image_url: string;
  scope_type: string;        // prefecture / region / nationwide
  scope_key: string;         // 神奈川 / 関東 / 全国 など
  destination_type: string;  // pref / feature / url
  destination_value: string;
  sort_order: number;
  is_active: boolean;
  start_at: string | null;   // timestamptz（NULL=制限なし）
  end_at: string | null;
  updated_at?: string;
}

interface AreaDraft {
  id: string | null;
  name: string;
  description: string;
  image_url: string;
  scope_type: string;
  scope_key: string;
  destination_type: string;
  destination_value: string;
  sort_order: number;
  is_active: boolean;
  start_at: string;  // datetime-local形式（空=制限なし）
  end_at: string;
}

// ─── 定数 ──────────────────────────────────────────────────────────────────

const REGIONS = ["北海道・東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"];

const SCOPE_LABEL: Record<string, string> = {
  prefecture: "都道府県", region: "地方", nationwide: "全国",
};

const DEST_OPTIONS: { value: string; label: string }[] = [
  { value: "pref",    label: "pref（都道府県タブへ切替）" },
  { value: "feature", label: "feature（特集ページを開く）" },
  { value: "url",     label: "url（外部URL）" },
];
const DEST_LABEL: Record<string, string> = { pref: "タブ切替", feature: "特集", url: "URL" };

function emptyArea(): AreaDraft {
  return {
    id: null, name: "", description: "", image_url: "",
    scope_type: "prefecture", scope_key: "",
    destination_type: "pref", destination_value: "",
    sort_order: 0, is_active: true, start_at: "", end_at: "",
  };
}

// ─── ユーティリティ ─────────────────────────────────────────────────────────

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

// 公開状態の判定（is_active × 掲載期間）
function areaStatus(a: AreaRow) {
  if (!a.is_active) return { label: "非公開", bg: "#fee2e2", color: "#dc2626" };
  const now = Date.now();
  if (a.start_at && new Date(a.start_at).getTime() > now) return { label: "公開前", bg: "#fef3c7", color: "#b45309" };
  if (a.end_at && new Date(a.end_at).getTime() <= now) return { label: "期間外", bg: "#fef3c7", color: "#b45309" };
  return { label: "公開中", bg: "#dcfce7", color: "#16a34a" };
}

// ─── スタイル ──────────────────────────────────────────────────────────────

const C = {
  pink:    "#ff8f7f",
  dark:    "#4a3034",
  gray:    "#9b7b82",
  border:  "#ead7db",
  bg:      "#fff5f7",
  green:   "#18794e",
  red:     "#c0385a",
};

// ページ全体（featured-pages と同じトーン）
const PAGE_BG = "#f9fafb";
const HEADER_BORDER = "#e5e7eb";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1.5px solid ${C.border}`,
  borderRadius: "8px", padding: "8px 12px", fontSize: "13px",
  outline: "none", background: "#fff", color: C.dark,
};
const lbl: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 700, color: C.dark, marginBottom: "4px" };
const btn = {
  base: { border: "none", borderRadius: "10px", padding: "9px 18px", fontWeight: 700, fontSize: "13px", cursor: "pointer" } as React.CSSProperties,
  primary: { background: "linear-gradient(135deg,#ffbf67,#ff8f7f)", color: "#fff" } as React.CSSProperties,
  sub: { background: "#fff", color: C.dark, border: `1.5px solid ${C.border}` } as React.CSSProperties,
  danger: { background: "#fff4f4", color: C.red, border: `1.5px solid #fca5a5` } as React.CSSProperties,
};

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: "16px",
  border: `1.5px solid ${C.border}`,
  boxShadow: "0 2px 12px rgba(74,48,52,0.07)", overflow: "hidden",
};

// ─── 管理パネル本体 ─────────────────────────────────────────────────────────

function PopularAreasPanel({ secret }: { secret: string }) {
  const [items, setItems]               = useState<AreaRow[]>([]);
  const [loading, setLoading]           = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [loadErr, setLoadErr]           = useState("");
  const [draft, setDraft]               = useState<AreaDraft | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [saveErr, setSaveErr]           = useState("");

  // ── データ取得 ──────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true); setLoadErr("");
    try {
      const r = await fetch(`/api/admin/popular-areas?secret=${secret}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "読み込み失敗");
      setTableMissing(!!j.tableMissing);
      setItems(j.data ?? []);
    } catch (e: any) { setLoadErr(e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── 編集開始 ────────────────────────────────────────────────────────────
  const startNew = () => {
    setSaved(false); setSaveErr("");
    setDraft(emptyArea());
  };
  const startEdit = (a: AreaRow) => {
    setSaved(false); setSaveErr("");
    setDraft({
      id: a.id,
      name: a.name ?? "",
      description: a.description ?? "",
      image_url: a.image_url ?? "",
      scope_type: a.scope_type ?? "prefecture",
      scope_key: a.scope_key ?? "",
      destination_type: a.destination_type ?? "pref",
      destination_value: a.destination_value ?? "",
      sort_order: a.sort_order ?? 0,
      is_active: a.is_active ?? true,
      start_at: isoToLocalInput(a.start_at),
      end_at: isoToLocalInput(a.end_at),
    });
  };

  // ── 保存 ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim())      { setSaveErr("エリア名は必須です"); return; }
    if (!draft.scope_key.trim()) { setSaveErr("範囲キー (scope_key) は必須です"); return; }
    setSaving(true); setSaved(false); setSaveErr("");
    try {
      const body = {
        secret,
        ...(draft.id ? { id: draft.id } : {}),
        name: draft.name.trim(),
        description: draft.description,
        image_url: draft.image_url,
        scope_type: draft.scope_type,
        scope_key: draft.scope_key.trim(),
        destination_type: draft.destination_type,
        destination_value: draft.destination_value,
        sort_order: draft.sort_order,
        is_active: draft.is_active,
        start_at: localInputToIso(draft.start_at),
        end_at: localInputToIso(draft.end_at),
      };
      const r = await fetch("/api/admin/popular-areas", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "保存失敗");
      setSaved(true);
      setDraft(null);
      await load();
    } catch (e: any) { setSaveErr(e.message); }
    finally { setSaving(false); }
  };

  // ── 削除 ────────────────────────────────────────────────────────────────
  const remove = async (a: AreaRow) => {
    if (!confirm(`人気エリア「${a.name}」（${SCOPE_LABEL[a.scope_type] ?? a.scope_type}: ${a.scope_key}）を削除しますか？`)) return;
    const r = await fetch("/api/admin/popular-areas", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, id: a.id }),
    });
    if (r.ok) {
      if (draft?.id === a.id) setDraft(null);
      await load();
    } else {
      alert("削除に失敗しました");
    }
  };

  // ── scope別グループ化 ────────────────────────────────────────────────────
  const groups: { key: string; scope_type: string; scope_key: string; rows: AreaRow[] }[] = [];
  for (const it of items) {
    const key = `${it.scope_type}|${it.scope_key}`;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, scope_type: it.scope_type, scope_key: it.scope_key, rows: [] }; groups.push(g); }
    g.rows.push(it);
  }

  // ── 遷移先の表示ラベル ──────────────────────────────────────────────────
  const destText = (a: AreaRow) => {
    if (a.destination_type === "pref")    return `タブ切替: ${a.destination_value || "(未設定)"}`;
    if (a.destination_type === "feature") return `特集: ${a.destination_value ? `${a.destination_value.slice(0, 8)}...` : "(未設定)"}`;
    if (a.destination_type === "url")     return `URL: ${a.destination_value || "(未設定)"}`;
    return `${a.destination_type}: ${a.destination_value}`;
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── ヘッダー ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: C.dark }}>🗺 人気エリア管理</div>
          <div style={{ fontSize: "13px", color: C.gray, marginTop: "3px" }}>
            特集TOPに横スクロールで表示する「人気エリア」カードを範囲（都道府県/地方/全国）ごとに管理します
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {loading && <span style={{ fontSize: "12px", color: C.gray }}>読み込み中...</span>}
          <button onClick={load} style={{ ...btn.base, ...btn.sub, padding: "8px 16px" }}>🔄 更新</button>
          <button onClick={startNew} style={{ ...btn.base, ...btn.primary, padding: "8px 16px" }}>＋ 新規追加</button>
        </div>
      </div>

      {/* ── テーブル未作成の案内 ── */}
      {tableMissing && (
        <div style={{ background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px" }}>
          <div style={{ fontWeight: 700, color: "#92400e", marginBottom: "6px" }}>
            ⚠ popular_areas テーブルが未作成です
          </div>
          <div style={{ fontSize: "13px", color: "#92400e", lineHeight: "1.7" }}>
            Supabase SQL Editor で <code style={{ background: "#fef3c7", padding: "1px 6px", borderRadius: "4px" }}>supabase/featured-scope-placement.sql</code> を実行してください。
            （特集ページの scope/掲載位置カラム追加と人気エリアの初期データ投入も同時に行われます）
          </div>
        </div>
      )}

      {loadErr && (
        <div style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderRadius: "12px", padding: "12px 16px", marginBottom: "20px", color: C.red, fontSize: "13px" }}>
          ⚠ {loadErr}
        </div>
      )}
      {saved && !draft && (
        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: "12px", padding: "12px 16px", marginBottom: "20px", color: C.green, fontSize: "13px", fontWeight: 700 }}>
          ✓ 保存しました！
        </div>
      )}

      {/* ── 追加/編集フォーム ── */}
      {draft && (
        <div style={{ ...cardStyle, marginBottom: "20px" }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: "15px", fontWeight: 800, color: C.dark }}>
              {draft.id ? `✏ 編集: ${draft.name || "(名称未設定)"}` : "＋ 人気エリアを新規追加"}
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
                  {draft.is_active ? "公開" : "非公開"}
                </span>
              </label>
              <button onClick={() => setDraft(null)} style={{ ...btn.base, ...btn.sub, padding: "8px 14px", fontSize: "12px" }}>キャンセル</button>
              <button onClick={save} disabled={saving} style={{ ...btn.base, ...btn.primary, opacity: saving ? 0.7 : 1 }}>
                {saving ? "保存中..." : "💾 保存する"}
              </button>
            </div>
          </div>

          {saveErr && (
            <div style={{ padding: "10px 20px", background: "#fef2f2", color: C.red, fontSize: "13px", borderBottom: `1px solid #fecaca` }}>
              ⚠ {saveErr}
            </div>
          )}

          <div style={{ padding: "20px", display: "grid", gap: "14px" }}>
            {/* 画像プレビュー */}
            {draft.image_url && (
              <img src={draft.image_url} alt="" style={{ width: "220px", height: "120px", objectFit: "cover" as const, borderRadius: "10px", border: `1px solid ${C.border}` }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={lbl}>エリア名 <span style={{ color: C.red }}>*</span></label>
                <input value={draft.name} onChange={(e) => setDraft((d) => d ? { ...d, name: e.target.value } : d)}
                  style={inp} placeholder="横浜" />
              </div>
              <div>
                <label style={lbl}>説明（サブテキスト）</label>
                <input value={draft.description} onChange={(e) => setDraft((d) => d ? { ...d, description: e.target.value } : d)}
                  style={inp} placeholder="みなとみらい・中華街" />
              </div>
            </div>
            <div>
              <label style={lbl}>画像URL</label>
              <input value={draft.image_url} onChange={(e) => setDraft((d) => d ? { ...d, image_url: e.target.value } : d)}
                style={inp} placeholder="https://images.unsplash.com/..." />
            </div>

            {/* 表示範囲 */}
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: "12px", padding: "14px", background: C.bg, display: "grid", gap: "12px" }}>
              <div style={{ fontSize: "13px", fontWeight: 800, color: C.dark }}>📌 表示するタブ（範囲）</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={lbl}>対象範囲</label>
                  <select value={draft.scope_type}
                    onChange={(e) => {
                      const st = e.target.value;
                      setDraft((d) => {
                        if (!d) return d;
                        const key = st === "nationwide" ? "全国"
                          : st === "region" ? (REGIONS.includes(d.scope_key) ? d.scope_key : "関東")
                          : "";
                        return { ...d, scope_type: st, scope_key: key };
                      });
                    }} style={inp}>
                    <option value="prefecture">都道府県</option>
                    <option value="region">地方</option>
                    <option value="nationwide">全国</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>範囲キー (scope_key) <span style={{ color: C.red }}>*</span></label>
                  {draft.scope_type === "region" ? (
                    <select value={draft.scope_key}
                      onChange={(e) => setDraft((d) => d ? { ...d, scope_key: e.target.value } : d)} style={inp}>
                      {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : draft.scope_type === "nationwide" ? (
                    <input value="全国" readOnly style={{ ...inp, background: "#f6f0f1", color: C.gray }} />
                  ) : (
                    <input value={draft.scope_key}
                      onChange={(e) => setDraft((d) => d ? { ...d, scope_key: e.target.value } : d)}
                      style={inp} placeholder="例: 神奈川" />
                  )}
                  {draft.scope_type === "prefecture" && (
                    <div style={{ fontSize: "11px", color: C.gray, marginTop: "3px" }}>
                      既存データと同じ表記で（例: 神奈川）
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* タップ時の遷移 */}
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: "12px", padding: "14px", background: C.bg, display: "grid", gap: "12px" }}>
              <div style={{ fontSize: "13px", fontWeight: 800, color: C.dark }}>👆 タップ時の遷移</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={lbl}>遷移タイプ</label>
                  <select value={draft.destination_type}
                    onChange={(e) => setDraft((d) => d ? { ...d, destination_type: e.target.value } : d)} style={inp}>
                    {DEST_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>遷移先の値</label>
                  <input value={draft.destination_value}
                    onChange={(e) => setDraft((d) => d ? { ...d, destination_value: e.target.value } : d)}
                    style={inp}
                    placeholder={
                      draft.destination_type === "pref" ? "例: 神奈川（切替先の都道府県）"
                      : draft.destination_type === "feature" ? "特集ページのID (uuid)"
                      : "https://..."
                    } />
                </div>
              </div>
            </div>

            {/* 表示順・掲載期間 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <div>
                <label style={lbl}>表示順</label>
                <input type="number" value={draft.sort_order}
                  onChange={(e) => setDraft((d) => d ? { ...d, sort_order: Number(e.target.value) } : d)}
                  style={inp} min={0} />
              </div>
              <div>
                <label style={lbl}>掲載開始</label>
                <input type="datetime-local" value={draft.start_at}
                  onChange={(e) => setDraft((d) => d ? { ...d, start_at: e.target.value } : d)} style={inp} />
              </div>
              <div>
                <label style={lbl}>掲載終了</label>
                <input type="datetime-local" value={draft.end_at}
                  onChange={(e) => setDraft((d) => d ? { ...d, end_at: e.target.value } : d)} style={inp} />
              </div>
            </div>
            <div style={{ fontSize: "11px", color: C.gray }}>掲載期間は空欄=制限なし。「公開」トグルと併用されます。</div>
          </div>
        </div>
      )}

      {/* ── 一覧（scope別グループ）── */}
      {!tableMissing && groups.length === 0 && !loading ? (
        <div style={{ ...cardStyle, padding: "40px", textAlign: "center", color: C.gray, fontSize: "13px" }}>
          まだ人気エリアがありません。「＋ 新規追加」から作成してください。
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} style={{ ...cardStyle, marginBottom: "16px" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#7c3aed", background: "#f3eaff", borderRadius: "999px", padding: "2px 9px" }}>
                {SCOPE_LABEL[g.scope_type] ?? g.scope_type}
              </span>
              <span style={{ fontSize: "14px", fontWeight: 800, color: C.dark }}>{g.scope_key}</span>
              <span style={{ fontSize: "12px", color: C.gray }}>({g.rows.length}件)</span>
            </div>
            {g.rows.map((a) => {
              const st = areaStatus(a);
              return (
                <div key={a.id} style={{
                  display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px",
                  borderBottom: `1px solid ${C.border}`,
                  background: draft?.id === a.id ? "#fff5f7" : "transparent",
                }}>
                  {/* サムネイル */}
                  {a.image_url ? (
                    <img src={a.image_url} alt="" style={{ width: "56px", height: "40px", objectFit: "cover" as const, borderRadius: "8px", border: `1px solid ${C.border}`, flexShrink: 0 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                  ) : (
                    <div style={{ width: "56px", height: "40px", borderRadius: "8px", background: C.bg, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>🗺</div>
                  )}
                  {/* 名前・説明 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" as const }}>
                      <span style={{ fontWeight: 700, fontSize: "13px", color: C.dark }}>#{a.sort_order} {a.name}</span>
                      <span style={{ fontSize: "11px", background: st.bg, color: st.color, borderRadius: "999px", padding: "1px 7px" }}>{st.label}</span>
                      <span style={{ fontSize: "11px", background: "#e8f1ff", color: "#4d84c4", borderRadius: "999px", padding: "1px 7px" }}>
                        {DEST_LABEL[a.destination_type] ?? a.destination_type}
                      </span>
                    </div>
                    <div style={{ fontSize: "11px", color: C.gray, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.description || "（説明なし）"} ／ {destText(a)}
                      {(a.start_at || a.end_at) && (
                        <> ／ 期間: {a.start_at ? isoToLocalInput(a.start_at).replace("T", " ") : "…"} 〜 {a.end_at ? isoToLocalInput(a.end_at).replace("T", " ") : "…"}</>
                      )}
                    </div>
                  </div>
                  {/* 操作 */}
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button onClick={() => startEdit(a)} style={{ ...btn.base, ...btn.sub, padding: "6px 12px", fontSize: "12px" }}>✏ 編集</button>
                    <button onClick={() => remove(a)} style={{ ...btn.base, ...btn.danger, padding: "6px 12px", fontSize: "12px" }}>🗑 削除</button>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

// ─── ページ本体（認証＋レイアウト）──────────────────────────────────────────
// 認証は /admin/featured-pages と同じ localStorage["moodgo-admin-secret"] 方式。

export default function PopularAreasAdmin() {
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

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh", backgroundColor: PAGE_BG,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  // 認証確認中/未ログインのリダイレクト中は空表示（このページ自身はパスワードを出さない）。
  if (!authed) return null;

  // ── メイン画面 ─────────────────────────────────────────────────────────
  return (
    <div style={pageStyle}>
      {/* ヘッダー（相互リンク） */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${HEADER_BORDER}`, padding: "16px 24px", display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
        <a href="/admin" style={{ color: "#6b7280", textDecoration: "none", fontSize: "13px" }}>← 管理画面</a>
        <span style={{ color: "#ccc" }}>/</span>
        <span style={{ fontSize: "20px", fontWeight: 800, color: "#1a1a1a" }}>🗺 人気エリア管理</span>
        <a href="/admin/featured-pages" style={{ fontSize: "12px", color: "#E56B9B", fontWeight: 700, textDecoration: "none" }}>
          🗺️ 特集ページ管理 →
        </a>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 24px 40px" }}>
        <PopularAreasPanel secret={secret} />
      </div>
    </div>
  );
}
