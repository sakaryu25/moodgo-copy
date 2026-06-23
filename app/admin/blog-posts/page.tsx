"use client";
// ─── /admin/blog-posts ───────────────────────────────────────────────────────
// ユーザーおすすめブログ投稿の管理レビュー: pending承認・却下・非表示。
// GET /api/blog-posts?review=1&status=&secret= で取得、POST {action:'moderate'} で状態変更。
// 詳細編集（タグ/場所/is_searchable等）は /admin/blog-posts/[id] で行う。
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Post = {
  id: string; title: string; place_name: string | null; caption: string | null;
  mood_tags: string[] | null; scene_tags: string[] | null; companion_tags: string[] | null;
  approval_status: string; is_searchable: boolean; report_count: number;
  helpful_count: number; created_at: string; photos?: string[];
};

const C = { purple: "#7C3AED", gray: "#6B7280", bg: "#F7F5FB", green: "#16A34A", red: "#DC2626", amber: "#D97706" };
type Filter = "pending" | "approved" | "rejected" | "hidden" | "reported";

export default function BlogPostsAdmin() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (sec: string, status: Filter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/blog-posts?review=1&status=${status}&secret=${encodeURIComponent(sec)}`);
      const d = await res.json();
      if (d?.ok) { setPosts(d.posts ?? []); setAuthed(true); }
      else alert("認証エラーまたは取得失敗");
    } catch { alert("通信エラー"); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("moodgo-admin-secret") : null;
    if (saved) { setSecret(saved); load(saved, filter); }
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (authed) load(secret, filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const moderate = async (postId: string, status: string) => {
    try {
      const res = await fetch("/api/blog-posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moderate", secret, postId, status, isSearchable: status === "approved" ? true : undefined, adminName: "admin" }),
      });
      const d = await res.json();
      if (d?.ok) setPosts(prev => prev.filter(p => p.id !== postId));
      else alert("変更失敗: " + (d?.error ?? ""));
    } catch { alert("通信エラー"); }
  };

  if (!authed) {
    return (
      <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
        <h2 style={{ color: C.purple }}>ブログ投稿管理</h2>
        <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="admin secret"
          style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd", marginTop: 12 }} />
        <button onClick={() => { localStorage.setItem("moodgo-admin-secret", secret); load(secret, filter); }}
          style={{ width: "100%", padding: 12, marginTop: 12, background: C.purple, color: "#fff", border: 0, borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
          {loading ? "読込中…" : "ログイン"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 20, fontFamily: "system-ui", background: C.bg, minHeight: "100vh" }}>
      <h2 style={{ color: C.purple }}>ブログ投稿管理（{posts.length}件）</h2>
      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        {(["pending", "reported", "approved", "rejected", "hidden"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid " + C.purple, cursor: "pointer",
              background: filter === f ? C.purple : "#fff", color: filter === f ? "#fff" : C.purple, fontWeight: 700 }}>
            {f === "pending" ? "承認待ち" : f === "reported" ? "通報あり" : f === "approved" ? "承認済み" : f === "rejected" ? "却下" : "非表示"}
          </button>
        ))}
        <button onClick={() => load(secret, filter)} style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 20, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>更新</button>
      </div>
      {posts.map(p => (
        <div key={p.id} style={{ background: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", gap: 12 }}>
          {(p.photos && p.photos[0]) ? (
            <img src={p.photos[0]} alt="" style={{ width: 84, height: 84, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
          ) : <div style={{ width: 84, height: 84, borderRadius: 10, background: "#eee", flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 15 }}>{p.title || "(no title)"}</strong>
              <span style={{ fontSize: 11, color: "#fff", background: p.approval_status === "approved" ? C.green : p.approval_status === "pending" ? C.amber : C.red, borderRadius: 6, padding: "1px 8px" }}>{p.approval_status}</span>
              {p.is_searchable && <span style={{ fontSize: 11, color: C.green }}>🔎検索可</span>}
              {(p.report_count ?? 0) > 0 && <span style={{ fontSize: 11, color: C.red }}>🚩{p.report_count}</span>}
              <span style={{ marginLeft: "auto", fontSize: 11, color: C.gray }}>{new Date(p.created_at).toLocaleDateString("ja-JP")}</span>
            </div>
            <div style={{ fontSize: 13, color: "#333", marginBottom: 4 }}>📍{p.place_name || "(場所未設定)"}</div>
            {p.caption && <div style={{ fontSize: 13, color: "#555", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.caption}</div>}
            <div style={{ fontSize: 11, color: C.gray, marginBottom: 8 }}>{[...(p.mood_tags ?? []), ...(p.scene_tags ?? [])].join(" ")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={`/admin/blog-posts/${p.id}`} style={{ padding: "6px 14px", borderRadius: 8, background: C.purple, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 13 }}>詳細・編集</Link>
              <button onClick={() => moderate(p.id, "approved")} style={{ padding: "6px 14px", border: 0, borderRadius: 8, background: C.green, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>そのまま承認</button>
              <button onClick={() => moderate(p.id, "hidden")} style={{ padding: "6px 14px", border: 0, borderRadius: 8, background: C.amber, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>非表示</button>
              <button onClick={() => moderate(p.id, "rejected")} style={{ padding: "6px 14px", border: 0, borderRadius: 8, background: C.red, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>却下</button>
            </div>
          </div>
        </div>
      ))}
      {posts.length === 0 && <p style={{ color: C.gray }}>該当する投稿はありません。</p>}
    </div>
  );
}
