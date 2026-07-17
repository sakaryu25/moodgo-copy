"use client";
// ── 期間限定スポット管理 ─────────────────────────────────────────────────────
// /admin/limited-spots
// available_from/until が入った「期間限定スポット」を一覧・編集（名前/住所/画像/タグ/期間）し、
// 「場所詳細への転載」をON/OFFできる。OFF=場所詳細に出ないが検索には残る（ユーザー指定 2026-07-18）。
// admin secret はハードコードしない。localStorage(moodgo-admin-secret)から読み、サーバが検証する。
import { useCallback, useEffect, useMemo, useState } from "react";

type Spot = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  tags: string[] | null;
  description: string | null;
  image_urls: string[] | null;
  photo_url: string | null;
  user_photos?: string[];   // 投稿(spot_photos)由来の写真。places.image_urlsが空でもこれで表示する
  available_from: string | null;
  available_until: string | null;
  source_type: string | null;
  is_active: boolean;
  repost_to_detail: boolean;
};

const API = "/api/admin/limited-spots";
const RENDER_CAP = 300;   // 一度に描画する最大件数（全件は取得済み・検索で全件から絞り込める）
const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

// 開催状態: 終了 / 開催前 / 開催中（期間未設定は「常時」）
function statusOf(s: Spot): { label: string; color: string; bg: string } {
  const t = todayJst();
  if (s.available_until && s.available_until < t) return { label: "終了", color: "#8A8A99", bg: "#EFEFF3" };
  if (s.available_from && s.available_from > t) return { label: "開催前", color: "#2563EB", bg: "#E7EEFF" };
  if (s.available_from || s.available_until) return { label: "開催中", color: "#0F9D58", bg: "#E4F6EC" };
  return { label: "常時", color: "#8A8A99", bg: "#EFEFF3" };
}
function splitAt(name: string): { event: string; venue: string } {
  const i = name.lastIndexOf("＠");
  return i > 0 ? { event: name.slice(0, i), venue: name.slice(i) } : { event: name, venue: "" };
}

export default function LimitedSpotsAdmin() {
  // 認証は /admin の一度きり。共有シークレット(localStorage["moodgo-admin-secret"])を読むだけで、
  //   このページ自身はパスワードを再要求しない。未ログインなら共通ログイン(/admin)へ送る。
  const [authed, setAuthed] = useState(false);
  const [secret, setSecret] = useState("");
  useEffect(() => {
    try {
      const s = localStorage.getItem("moodgo-admin-secret");
      if (s) { setSecret(s); setAuthed(true); }
      else { window.location.replace("/admin"); }
    } catch { window.location.replace("/admin"); }
  }, []);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [flagReady, setFlagReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [showEnded, setShowEnded] = useState(true);

  const load = useCallback(async () => {
    if (!secret) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list", secret }) });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "取得に失敗しました"); setSpots([]); }
      else { setSpots(d.spots ?? []); setFlagReady(d.flagReady !== false); }
    } catch { setErr("通信に失敗しました"); }
    setLoading(false);
  }, [secret]);
  useEffect(() => { if (authed) load(); }, [authed, load]);

  const filtered = useMemo(() => {
    const t = todayJst();
    return spots.filter((s) => {
      if (!showEnded && s.available_until && s.available_until < t) return false;
      if (q.trim()) { const k = q.trim().toLowerCase(); if (!(`${s.name} ${s.address ?? ""}`.toLowerCase().includes(k))) return false; }
      return true;
    });
  }, [spots, q, showEnded]);

  const patchLocal = (id: string, patch: Partial<Spot>) => setSpots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // 転載トグル（即保存・楽観更新）
  const toggleRepost = async (s: Spot) => {
    const next = !s.repost_to_detail;
    patchLocal(s.id, { repost_to_detail: next });
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-repost", secret, id: s.id, repost_to_detail: next }) });
      const d = await r.json();
      if (!d.ok) { patchLocal(s.id, { repost_to_detail: !next }); if (d.needsSql) setFlagReady(false); else alert(d.error || "保存に失敗しました"); }
    } catch { patchLocal(s.id, { repost_to_detail: !next }); }
  };

  // 認証確認中/未ログインのリダイレクト中は空表示（パスワード画面は出さない）。
  if (!authed) return null;

  const t = todayJst();
  const activeCount = spots.filter((s) => !(s.available_until && s.available_until < t) && s.is_active).length;

  return (
    <div style={css.shell}>
    <div style={css.page}>
      <div style={css.head}>
        <div>
          <div style={css.h1}>📅 期間限定スポット管理</div>
          <div style={css.hsub}>開催中 {activeCount} / 全 {spots.length} 件。名前・住所・画像・タグ・期間を編集でき、「場所詳細への転載」をON/OFFできます。</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/admin" style={css.linkBtn}>← 管理トップ</a>
          <button onClick={load} style={css.reloadBtn} disabled={loading}>{loading ? "読込中…" : "↻ 更新"}</button>
        </div>
      </div>

      <div style={css.explain}>
        <b>「場所詳細への転載」とは：</b> ONにすると、そのスポットの詳細ページ（会場ページ）の「期間限定イベント」欄に表示されます。
        <b style={{ color: "#0F9D58" }}> OFFにしても検索結果には残ります</b>（場所詳細にだけ出さない設定です）。
      </div>

      {!flagReady && (
        <div style={css.sqlWarn}>
          ⚠️ 転載ON/OFF用のDB列（repost_to_detail）が未適用です。<b> supabase/add-place-repost-flag.sql</b> をSupabaseに適用するまで、転載の切替は保存されません（名前/住所/画像/タグ/期間の編集は可能です）。
        </div>
      )}

      <div style={css.toolbar}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 名前・住所で絞り込み" style={css.search} />
        <label style={css.chk}><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} /> 終了分も表示</label>
      </div>

      {err && <div style={css.err}>{err}</div>}
      {!loading && filtered.length === 0 && <div style={css.empty}>該当する期間限定スポットがありません。</div>}
      {filtered.length > RENDER_CAP && (
        <div style={css.capNote}>表示は先頭 {RENDER_CAP} 件です（該当 {filtered.length} 件）。目的のスポットは上の検索で絞り込んでください。</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.slice(0, RENDER_CAP).map((s) => (
          <SpotCard key={s.id} spot={s} secret={secret} onToggleRepost={() => toggleRepost(s)} onPatchLocal={(p) => patchLocal(s.id, p)} onReload={load} onFlagNotReady={() => setFlagReady(false)} />
        ))}
      </div>
    </div>
    </div>
  );
}

function SpotCard({ spot, secret, onToggleRepost, onPatchLocal, onReload, onFlagNotReady }: {
  spot: Spot; secret: string; onToggleRepost: () => void; onPatchLocal: (p: Partial<Spot>) => void; onReload: () => void; onFlagNotReady: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(spot.name);
  const [address, setAddress] = useState(spot.address ?? "");
  const [tags, setTags] = useState((spot.tags ?? []).join(" "));
  const [images, setImages] = useState((spot.image_urls ?? []).join("\n"));
  const [from, setFrom] = useState(spot.available_from ?? "");
  const [until, setUntil] = useState(spot.available_until ?? "");

  useEffect(() => {
    if (!editing) {
      setName(spot.name); setAddress(spot.address ?? ""); setTags((spot.tags ?? []).join(" "));
      setImages((spot.image_urls ?? []).join("\n")); setFrom(spot.available_from ?? ""); setUntil(spot.available_until ?? "");
    }
  }, [spot, editing]);

  const st = statusOf(spot);
  const { event, venue } = splitAt(spot.name);
  // image_urls(admin編集) → 投稿写真(spot_photos) → 旧photo_url の順でサムネイル。
  const userPhotos = spot.user_photos ?? [];
  const thumb = (spot.image_urls ?? [])[0] || userPhotos[0] || spot.photo_url || "";

  const save = async () => {
    setSaving(true);
    const patch = {
      name: name.trim(),
      address: address.trim(),
      tags: tags.split(/[\s,、]+/).map((x) => x.trim()).filter(Boolean),
      image_urls: images.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean),
      available_from: from.trim() || null,
      available_until: until.trim() || null,
    };
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", secret, id: spot.id, patch }) });
      const d = await r.json();
      if (d.ok) {
        onPatchLocal({ ...patch });
        if (d.warning) alert(d.warning);
        setEditing(false);
      } else { if (d.needsSql) onFlagNotReady(); alert(d.error || "保存に失敗しました"); }
    } catch { alert("通信に失敗しました"); }
    setSaving(false);
  };

  const del = async () => {
    if (!confirm(`「${spot.name}」を非公開(削除)にしますか？\n検索・場所詳細から外れますが、写真/評価は残り復活できます。`)) return;
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", secret, id: spot.id }) });
    const d = await r.json(); if (d.ok) onPatchLocal({ is_active: false }); else alert(d.error || "失敗しました");
  };
  const restore = async () => {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", secret, id: spot.id }) });
    const d = await r.json(); if (d.ok) onPatchLocal({ is_active: true }); else alert(d.error || "失敗しました");
  };

  return (
    <div style={{ ...css.card, opacity: spot.is_active ? 1 : 0.6 }}>
      <div style={{ display: "flex", gap: 12 }}>
        {thumb
          ? (
            <div style={{ position: "relative", flexShrink: 0 }}>
              <img src={thumb} alt="" style={css.thumb} />
              {(spot.image_urls ?? []).length === 0 && userPhotos.length > 0 && (
                <span style={css.postedTag}>投稿{userPhotos.length}</span>
              )}
            </div>
          )
          : <div style={{ ...css.thumb, ...css.thumbEmpty }}>No Image</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...css.statusPill, color: st.color, background: st.bg }}>{st.label}</span>
            {!spot.is_active && <span style={css.deletedPill}>非公開</span>}
            <span style={css.name}>{event}</span>
            {venue && <span style={css.venue}>{venue}</span>}
          </div>
          <div style={css.meta}>
            {(spot.available_from || spot.available_until)
              ? <>📅 {spot.available_from || "—"} 〜 {spot.available_until || "—"}</>
              : <>📅 期間未設定（常時）</>}
            {spot.address && <> ・ 📍 {spot.address}</>}
          </div>
          {(spot.tags ?? []).length > 0 && (
            <div style={css.tagRow}>{(spot.tags ?? []).slice(0, 12).map((tg, i) => <span key={i} style={css.tag}>{tg}</span>)}</div>
          )}
        </div>

        {/* 転載トグル（大きく分かりやすく） */}
        <div style={css.repostBox}>
          <div style={css.repostLabel}>場所詳細に転載</div>
          <button onClick={onToggleRepost} style={{ ...css.switch, background: spot.repost_to_detail ? "#0F9D58" : "#C9C9D2" }} title="場所詳細のイベント欄への表示。OFFでも検索には残ります。">
            <span style={{ ...css.knob, transform: spot.repost_to_detail ? "translateX(22px)" : "translateX(2px)" }} />
          </button>
          <div style={{ ...css.repostState, color: spot.repost_to_detail ? "#0F9D58" : "#9A9AA6" }}>{spot.repost_to_detail ? "表示中" : "非表示"}</div>
        </div>
      </div>

      {/* アクション */}
      <div style={css.actions}>
        {!editing && <button onClick={() => setEditing(true)} style={css.editBtn}>✏️ 編集</button>}
        {editing && <button onClick={save} disabled={saving} style={css.saveBtn}>{saving ? "保存中…" : "💾 保存"}</button>}
        {editing && <button onClick={() => setEditing(false)} style={css.cancelBtn}>キャンセル</button>}
        <div style={{ flex: 1 }} />
        {spot.is_active
          ? <button onClick={del} style={css.delBtn}>削除(非公開)</button>
          : <button onClick={restore} style={css.restoreBtn}>復活</button>}
      </div>

      {editing && (
        <div style={css.editor}>
          <Field label="名前"><input value={name} onChange={(e) => setName(e.target.value)} style={css.input} placeholder="イベント名＠会場名" /></Field>
          <Field label="住所"><input value={address} onChange={(e) => setAddress(e.target.value)} style={css.input} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="開始日 (YYYY-MM-DD)"><input value={from} onChange={(e) => setFrom(e.target.value)} style={css.input} placeholder="2026-07-01" /></Field>
            <Field label="終了日 (YYYY-MM-DD)"><input value={until} onChange={(e) => setUntil(e.target.value)} style={css.input} placeholder="2026-08-31" /></Field>
          </div>
          <Field label="タグ（スペース/カンマ区切り）"><input value={tags} onChange={(e) => setTags(e.target.value)} style={css.input} placeholder="#お祭り #夏 #花火" /></Field>
          <Field label="画像URL（1行=1枚。先頭がサムネイル）"><textarea value={images} onChange={(e) => setImages(e.target.value)} style={{ ...css.input, height: 72, resize: "vertical" as const, fontFamily: "monospace", fontSize: 12 }} placeholder="https://…/photo1.jpg" /></Field>
          {images.trim() && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {images.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean).slice(0, 8).map((u, i) => (
                <img key={i} src={u} alt="" style={css.previewThumb} />
              ))}
            </div>
          )}
          {userPhotos.length > 0 && (
            <div>
              <div style={css.fieldLabel}>投稿写真（{userPhotos.length}枚・利用者がアプリから投稿。検索/場所詳細では自動表示されます）</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {userPhotos.slice(0, 8).map((u, i) => <img key={i} src={u} alt="" style={css.previewThumb} />)}
                <button type="button" onClick={() => setImages([...new Set([...userPhotos, ...images.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)])].join("\n"))} style={css.usePostedBtn}>↑ 画像URLに取り込む</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block", flex: 1 }}><div style={css.fieldLabel}>{label}</div>{children}</label>;
}

const css: Record<string, React.CSSProperties> = {
  shell: { minHeight: "100vh", background: "#F4F4F8" },
  page: { maxWidth: 920, margin: "0 auto", padding: "20px 16px 80px", fontFamily: "system-ui, -apple-system, sans-serif", color: "#2A2440" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  h1: { fontSize: 22, fontWeight: 800 },
  hsub: { fontSize: 13, color: "#6B6B7B", marginTop: 4, lineHeight: 1.5, maxWidth: 620 },
  linkBtn: { padding: "8px 14px", borderRadius: 10, background: "#F0F0F5", color: "#4A4560", textDecoration: "none", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" },
  reloadBtn: { padding: "8px 14px", borderRadius: 10, background: "linear-gradient(135deg,#c084fc,#8b5cf6)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  explain: { fontSize: 13, lineHeight: 1.6, background: "#F6F3FF", border: "1px solid #E6DEFF", borderRadius: 12, padding: "10px 14px", marginBottom: 12 },
  sqlWarn: { fontSize: 13, lineHeight: 1.6, background: "#FFF4E5", border: "1px solid #FFD8A8", borderRadius: 12, padding: "10px 14px", marginBottom: 12 },
  toolbar: { display: "flex", gap: 12, alignItems: "center", marginBottom: 12 },
  search: { flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #E2E2EA", fontSize: 14, outline: "none" },
  chk: { fontSize: 13, color: "#6B6B7B", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" },
  err: { background: "#FDECEC", color: "#C0392B", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 12 },
  empty: { textAlign: "center", color: "#9A9AA6", padding: "40px 0", fontSize: 14 },
  capNote: { fontSize: 12.5, color: "#8A6D00", background: "#FFFBEB", border: "1px solid #FCE9A8", borderRadius: 10, padding: "8px 12px", marginBottom: 10 },
  card: { background: "#fff", border: "1px solid #ECECF2", borderRadius: 16, padding: 14, boxShadow: "0 2px 10px rgba(74,48,52,0.05)" },
  thumb: { width: 88, height: 88, borderRadius: 12, objectFit: "cover", background: "#F0F0F5", flexShrink: 0 },
  thumbEmpty: { display: "flex", alignItems: "center", justifyContent: "center", color: "#B8B8C4", fontSize: 11 },
  statusPill: { fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 999 },
  deletedPill: { fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 999, color: "#C0392B", background: "#FDECEC" },
  name: { fontSize: 16, fontWeight: 800 },
  venue: { fontSize: 13, color: "#8A8A99", fontWeight: 600 },
  meta: { fontSize: 12.5, color: "#6B6B7B", marginTop: 5, lineHeight: 1.5 },
  tagRow: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 },
  tag: { fontSize: 11, color: "#7C5BD6", background: "#F1ECFF", borderRadius: 999, padding: "2px 8px", fontWeight: 700 },
  repostBox: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, width: 92 },
  repostLabel: { fontSize: 11, color: "#6B6B7B", fontWeight: 700, textAlign: "center", lineHeight: 1.3 },
  switch: { width: 46, height: 26, borderRadius: 999, border: "none", position: "relative", cursor: "pointer", padding: 0, transition: "background .15s" },
  knob: { position: "absolute", top: 2, left: 0, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "transform .15s" },
  repostState: { fontSize: 11, fontWeight: 800 },
  actions: { display: "flex", gap: 8, alignItems: "center", marginTop: 12, borderTop: "1px solid #F2F2F7", paddingTop: 10 },
  editBtn: { padding: "7px 14px", borderRadius: 9, background: "#F0F0F5", color: "#4A4560", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  saveBtn: { padding: "7px 14px", borderRadius: 9, background: "linear-gradient(135deg,#34d399,#10b981)", color: "#fff", border: "none", fontSize: 13, fontWeight: 800, cursor: "pointer" },
  cancelBtn: { padding: "7px 14px", borderRadius: 9, background: "transparent", color: "#8A8A99", border: "1px solid #E2E2EA", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  delBtn: { padding: "7px 14px", borderRadius: 9, background: "#FDECEC", color: "#C0392B", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  restoreBtn: { padding: "7px 14px", borderRadius: 9, background: "#E4F6EC", color: "#0F9D58", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  editor: { marginTop: 12, display: "flex", flexDirection: "column", gap: 10, background: "#FAFAFD", borderRadius: 12, padding: 12 },
  fieldLabel: { fontSize: 11.5, color: "#8A8A99", fontWeight: 700, marginBottom: 4 },
  input: { width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid #E2E2EA", fontSize: 13.5, outline: "none", boxSizing: "border-box" },
  previewThumb: { width: 56, height: 56, borderRadius: 8, objectFit: "cover", background: "#F0F0F5" },
  postedTag: { position: "absolute", left: 5, bottom: 5, fontSize: 10, fontWeight: 800, color: "#fff", background: "rgba(15,157,88,0.94)", borderRadius: 6, padding: "1px 6px" },
  usePostedBtn: { padding: "6px 12px", borderRadius: 8, background: "#EEF6FF", color: "#2563EB", border: "1px solid #BFDBFE", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  authWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F6F3FF", fontFamily: "system-ui, sans-serif" },
  authCard: { background: "#fff", borderRadius: 18, padding: 28, width: 320, boxShadow: "0 10px 40px rgba(124,91,214,0.15)", textAlign: "center" },
  authTitle: { fontSize: 18, fontWeight: 800, color: "#2A2440" },
  authSub: { fontSize: 13, color: "#8A8A99", margin: "6px 0 16px" },
  authInput: { width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #E2E2EA", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12 },
  authBtn: { width: "100%", padding: "11px", borderRadius: 10, background: "linear-gradient(135deg,#c084fc,#8b5cf6)", color: "#fff", border: "none", fontSize: 14, fontWeight: 800, cursor: "pointer" },
};
