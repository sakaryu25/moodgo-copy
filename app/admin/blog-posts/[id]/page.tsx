"use client";
// ─── /admin/blog-posts/[id] ──────────────────────────────────────────────────
// ブログ投稿の詳細・編集・承認。タグ/場所/本文を確認/修正し、is_searchable・写真再利用を設定して承認。
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const C = { purple: "#7C3AED", gray: "#6B7280", bg: "#F7F5FB", green: "#16A34A", red: "#DC2626", amber: "#D97706", line: "#E5E1F0" };

type Post = {
  id: string; title: string; caption: string | null; body: string | null;
  place_name: string | null; address: string | null; area: string | null;
  place_id: string | null; google_place_id: string | null; google_maps_url: string | null;
  official_url: string | null; instagram_url: string | null;
  lat: number | null; lng: number | null;
  mood_tags: string[] | null; scene_tags: string[] | null; companion_tags: string[] | null;
  budget_level: string | null; approval_status: string; is_searchable: boolean;
  can_use_as_spot_source: boolean; report_count: number; rejected_reason: string | null;
  poster_name: string | null; created_at: string; photos?: string[];
};

function tagStr(a: string[] | null | undefined) { return (a ?? []).join(" "); }
function parseTags(s: string) { return s.split(/[\s,、]+/).map(t => t.trim()).filter(Boolean).map(t => t.startsWith("#") ? t : "#" + t); }

export default function BlogPostDetail() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? "");
  const [secret, setSecret] = useState("");
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 編集フォーム
  const [f, setF] = useState<Record<string, string>>({});
  const [isSearchable, setIsSearchable] = useState(false);
  const [canSpotSource, setCanSpotSource] = useState(false);
  const [canSpotPhoto, setCanSpotPhoto] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async (sec: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/blog-posts?review=1&id=${id}&secret=${encodeURIComponent(sec)}`);
      const d = await res.json();
      if (d?.ok && d.post) {
        const p: Post = d.post; setPost(p);
        setF({ title: p.title ?? "", caption: p.caption ?? "", body: p.body ?? "",
          place_name: p.place_name ?? "", address: p.address ?? "", area: p.area ?? "",
          place_id: p.place_id ?? "", google_place_id: p.google_place_id ?? "",
          mood_tags: tagStr(p.mood_tags), scene_tags: tagStr(p.scene_tags), companion_tags: tagStr(p.companion_tags),
          budget_level: p.budget_level ?? "", lat: p.lat != null ? String(p.lat) : "", lng: p.lng != null ? String(p.lng) : "" });
        setIsSearchable(!!p.is_searchable); setCanSpotSource(!!p.can_use_as_spot_source); setCanSpotPhoto(false);
      } else if (res.status === 401) alert("認証エラー");
      else alert("取得失敗");
    } catch { alert("通信エラー"); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("moodgo-admin-secret") : null;
    if (saved) { setSecret(saved); load(saved); }
  }, [load]);

  const send = async (status?: string) => {
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {
        title: f.title, caption: f.caption, body: f.body, place_name: f.place_name,
        address: f.address, area: f.area, place_id: f.place_id, google_place_id: f.google_place_id,
        mood_tags: parseTags(f.mood_tags), scene_tags: parseTags(f.scene_tags), companion_tags: parseTags(f.companion_tags),
        budget_level: f.budget_level,
      };
      if (f.lat && !isNaN(Number(f.lat))) fields.lat = Number(f.lat);
      if (f.lng && !isNaN(Number(f.lng))) fields.lng = Number(f.lng);
      const body: Record<string, unknown> = {
        action: "moderate", secret, postId: id, fields,
        isSearchable, canUseAsSpotSource: canSpotSource, canUseAsSpotPhoto: canSpotPhoto, adminName: "admin",
      };
      if (status) { body.status = status; if (status === "rejected") body.rejectedReason = rejectReason; }
      const res = await fetch("/api/blog-posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (d?.ok) {
        if (status && status !== "approved") { router.push("/admin/blog-posts"); return; }
        alert(status === "approved" ? "承認しました" : "保存しました"); load(secret);
      } else alert("失敗: " + (d?.error ?? ""));
    } catch { alert("通信エラー"); } finally { setSaving(false); }
  };

  const inp = (k: string, label: string, multi = false) => (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ fontSize: 12, color: C.gray, fontWeight: 700 }}>{label}</span>
      {multi
        ? <textarea value={f[k] ?? ""} onChange={e => setF({ ...f, [k]: e.target.value })} rows={4}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${C.line}`, marginTop: 4, fontFamily: "inherit", resize: "vertical" }} />
        : <input value={f[k] ?? ""} onChange={e => setF({ ...f, [k]: e.target.value })}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${C.line}`, marginTop: 4 }} />}
    </label>
  );

  if (!post) {
    return <div style={{ maxWidth: 720, margin: "60px auto", padding: 24, fontFamily: "system-ui" }}>
      {loading ? "読込中…" : <>
        <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="admin secret"
          style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd" }} />
        <button onClick={() => { localStorage.setItem("moodgo-admin-secret", secret); load(secret); }}
          style={{ width: "100%", padding: 12, marginTop: 12, background: C.purple, color: "#fff", border: 0, borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>読み込む</button>
      </>}
    </div>;
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 20, fontFamily: "system-ui", background: C.bg, minHeight: "100vh" }}>
      <button onClick={() => router.push("/admin/blog-posts")} style={{ background: "none", border: 0, color: C.purple, cursor: "pointer", fontWeight: 700, marginBottom: 8 }}>← 一覧へ</button>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h2 style={{ color: C.purple, margin: 0 }}>投稿詳細</h2>
        <span style={{ fontSize: 12, color: "#fff", background: post.approval_status === "approved" ? C.green : post.approval_status === "pending" ? C.amber : C.red, borderRadius: 6, padding: "2px 10px" }}>{post.approval_status}</span>
        {(post.report_count ?? 0) > 0 && <span style={{ fontSize: 12, color: C.red }}>🚩{post.report_count}</span>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: C.gray }}>{post.poster_name || "匿名"} ・{new Date(post.created_at).toLocaleString("ja-JP")}</span>
      </div>

      {/* 写真確認 */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 4 }}>
        {(post.photos ?? []).map((u, i) => <img key={i} src={u} alt="" style={{ width: 140, height: 140, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />)}
        {(post.photos ?? []).length === 0 && <span style={{ color: C.gray, fontSize: 13 }}>写真なし</span>}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        {inp("title", "タイトル")}
        {inp("caption", "ひとこと")}
        {inp("body", "本文", true)}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {inp("place_name", "場所名/お店名")}
          {inp("area", "エリア")}
        </div>
        {inp("address", "住所")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {inp("place_id", "places.id 紐付け（任意）")}
          {inp("google_place_id", "google_place_id（任意）")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {inp("lat", "緯度")}
          {inp("lng", "経度")}
          {inp("budget_level", "予算感")}
        </div>
        {inp("mood_tags", "気分タグ（スペース区切り #まったりしたい 等）")}
        {inp("scene_tags", "ジャンルタグ（#カフェスイーツ 等）")}
        {inp("companion_tags", "誰とタグ（#1人 #友達 等）")}
      </div>

      {/* 検索/再利用フラグ */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={isSearchable} onChange={e => setIsSearchable(e.target.checked)} />
          <span><strong>検索結果に出す</strong>（is_searchable）— 承認＋ONで検索候補に混ざる</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={canSpotPhoto} onChange={e => setCanSpotPhoto(e.target.checked)} />
          <span>投稿写真をスポット写真として再利用OK（can_use_as_spot_photo）</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={canSpotSource} onChange={e => setCanSpotSource(e.target.checked)} />
          <span>新スポット候補として扱う（can_use_as_spot_source）※placesへは別途昇格</span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button disabled={saving} onClick={() => send()} style={{ padding: "10px 18px", border: `1px solid ${C.purple}`, borderRadius: 10, background: "#fff", color: C.purple, cursor: "pointer", fontWeight: 700 }}>保存のみ</button>
        <button disabled={saving} onClick={() => send("approved")} style={{ padding: "10px 18px", border: 0, borderRadius: 10, background: C.green, color: "#fff", cursor: "pointer", fontWeight: 700 }}>保存して承認</button>
        <button disabled={saving} onClick={() => send("hidden")} style={{ padding: "10px 18px", border: 0, borderRadius: 10, background: C.amber, color: "#fff", cursor: "pointer", fontWeight: 700 }}>非表示</button>
      </div>
      <div style={{ background: "#fff", borderRadius: 12, padding: 16 }}>
        <span style={{ fontSize: 12, color: C.gray, fontWeight: 700 }}>却下理由（任意）</span>
        <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="例: 他サイトからの転載が疑われる"
          style={{ width: "100%", padding: 10, borderRadius: 8, border: `1px solid ${C.line}`, margin: "4px 0 10px" }} />
        <button disabled={saving} onClick={() => send("rejected")} style={{ padding: "10px 18px", border: 0, borderRadius: 10, background: C.red, color: "#fff", cursor: "pointer", fontWeight: 700 }}>却下する</button>
      </div>
    </div>
  );
}
