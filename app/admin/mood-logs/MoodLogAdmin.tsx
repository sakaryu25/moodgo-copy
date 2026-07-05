"use client";
// ─── /admin/mood-logs ────────────────────────────────────────────────────────
// Moodログ（spot_posts）の管理レビュー: pending承認・却下・非表示。
// GET /api/spot-posts?review=1&secret= で全件取得、POST {action:'moderate'} で状態変更。
import { useCallback, useEffect, useState } from "react";

type Post = {
  id: string; place_name: string | null; caption: string | null;
  mood_tags: string[] | null; companion: string | null; visibility: string;
  status: string; like_count: number; helpful_count: number; revisit_count: number;
  report_count: number; created_at: string; device_id?: string;
};

const C = { purple: "#7C3AED", gray: "#6B7280", bg: "#F7F5FB", green: "#16A34A", red: "#DC2626", amber: "#D97706" };

export default function MoodLogAdmin({ secret: propSecret }: { secret?: string } = {}) {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "reported">("pending");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (sec: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/spot-posts?review=1&secret=${encodeURIComponent(sec)}`);
      const d = await res.json();
      if (d?.ok) { setPosts(d.posts ?? []); setAuthed(true); }
      else alert("認証エラーまたは取得失敗");
    } catch { alert("通信エラー"); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const saved = propSecret || (typeof window !== "undefined" ? localStorage.getItem("moodgo-admin-secret") : null);
    if (saved) { setSecret(saved); load(saved); }
  }, [load, propSecret]);

  const moderate = async (postId: string, status: string) => {
    try {
      const res = await fetch("/api/spot-posts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moderate", secret, postId, status }),
      });
      const d = await res.json();
      if (d?.ok) setPosts(prev => prev.map(p => p.id === postId ? { ...p, status } : p));
      else alert("変更失敗: " + (d?.error ?? ""));
    } catch { alert("通信エラー"); }
  };

  const shown = posts.filter(p =>
    filter === "all" ? true : filter === "reported" ? (p.report_count ?? 0) > 0 : p.status === "pending");

  if (!authed) {
    return (
      <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
        <h2 style={{ color: C.purple }}>Moodログ管理</h2>
        <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="admin secret"
          style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd", marginTop: 12 }} />
        <button onClick={() => { localStorage.setItem("moodgo-admin-secret", secret); load(secret); }}
          style={{ width: "100%", padding: 12, marginTop: 12, background: C.purple, color: "#fff", border: 0, borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
          {loading ? "読込中…" : "ログイン"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 20, fontFamily: "system-ui", background: C.bg, minHeight: "100vh" }}>
      <h2 style={{ color: C.purple }}>Moodログ管理（{shown.length}件）</h2>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {(["pending", "reported", "all"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid " + C.purple, cursor: "pointer",
              background: filter === f ? C.purple : "#fff", color: filter === f ? "#fff" : C.purple, fontWeight: 700 }}>
            {f === "pending" ? "承認待ち" : f === "reported" ? "通報あり" : "全件"}
          </button>
        ))}
        <button onClick={() => load(secret)} style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 20, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>更新</button>
      </div>
      {shown.map(p => (
        <div key={p.id} style={{ background: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong>{p.place_name || "(no name)"}</strong>
            <span style={{ fontSize: 12, color: "#fff", background: p.status === "approved" ? C.green : p.status === "pending" ? C.amber : C.red, borderRadius: 6, padding: "1px 8px" }}>{p.status}</span>
            <span style={{ fontSize: 12, color: C.gray }}>{p.visibility}</span>
            {(p.report_count ?? 0) > 0 && <span style={{ fontSize: 12, color: C.red }}>🚩{p.report_count}</span>}
            <span style={{ marginLeft: "auto", fontSize: 12, color: C.gray }}>{new Date(p.created_at).toLocaleString("ja-JP")}</span>
          </div>
          {p.caption && <div style={{ fontSize: 14, marginBottom: 6 }}>{p.caption}</div>}
          <div style={{ fontSize: 12, color: C.gray, marginBottom: 8 }}>
            {(p.mood_tags ?? []).join(" ")} {p.companion ? `・${p.companion}` : ""} ・👍{p.like_count ?? 0} 🙏{p.helpful_count ?? 0} 🔁{p.revisit_count ?? 0}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => moderate(p.id, "approved")} style={{ padding: "6px 14px", border: 0, borderRadius: 8, background: C.green, color: "#fff", cursor: "pointer", fontWeight: 700 }}>承認</button>
            <button onClick={() => moderate(p.id, "hidden")} style={{ padding: "6px 14px", border: 0, borderRadius: 8, background: C.amber, color: "#fff", cursor: "pointer", fontWeight: 700 }}>非表示</button>
            <button onClick={() => moderate(p.id, "rejected")} style={{ padding: "6px 14px", border: 0, borderRadius: 8, background: C.red, color: "#fff", cursor: "pointer", fontWeight: 700 }}>却下</button>
          </div>
        </div>
      ))}
      {shown.length === 0 && <p style={{ color: C.gray }}>該当する投稿はありません。</p>}
    </div>
  );
}
