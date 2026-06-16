"use client";
// ─── /admin/server-errors ─────────────────────────────────────────────────────
// サーバー側の想定外エラー（書戻し/生成/検索フロー失敗）の閲覧・掃除。
import { useCallback, useEffect, useState } from "react";

type Row = { id: string; scope: string; message: string | null; code: string | null; meta: unknown; created_at: string };
const C = { purple: "#7C3AED", gray: "#6B7280", bg: "#F7F5FB", red: "#DC2626" };

export default function ServerErrorsAdmin() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [byScope, setByScope] = useState<Record<string, number>>({});
  const [scope, setScope] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async (sec: string, sc = "") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/server-errors?secret=${encodeURIComponent(sec)}${sc ? `&scope=${encodeURIComponent(sc)}` : ""}`);
      const d = await res.json();
      if (res.status === 401) { alert("認証エラー"); return; }
      setRows(d.errors ?? []); setByScope(d.byScope ?? {}); setNote(d.note ?? ""); setAuthed(true);
    } catch { alert("通信エラー"); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("moodgo-admin-secret") : null;
    if (saved) { setSecret(saved); load(saved); }
  }, [load]);

  const clearOld = async (days: number) => {
    if (!confirm(days > 0 ? `${days}日より古いログを削除しますか？` : "全ログを削除しますか？")) return;
    const res = await fetch("/api/admin/server-errors", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear", secret, olderThanDays: days }),
    });
    const d = await res.json();
    if (d?.ok) { alert(`${d.deleted}件削除`); load(secret, scope); } else alert("削除失敗: " + (d?.error ?? ""));
  };

  if (!authed) {
    return (
      <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
        <h2 style={{ color: C.purple }}>サーバーエラー監視</h2>
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
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20, fontFamily: "system-ui", background: C.bg, minHeight: "100vh" }}>
      <h2 style={{ color: C.purple }}>サーバーエラー監視（{rows.length}件表示）</h2>
      {note && <p style={{ color: C.gray, fontSize: 13 }}>{note}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0", alignItems: "center" }}>
        <button onClick={() => { setScope(""); load(secret, ""); }}
          style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid " + C.purple, cursor: "pointer", background: scope === "" ? C.purple : "#fff", color: scope === "" ? "#fff" : C.purple, fontWeight: 700 }}>すべて</button>
        {Object.entries(byScope).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
          <button key={s} onClick={() => { setScope(s); load(secret, s); }}
            style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid " + C.purple, cursor: "pointer", background: scope === s ? C.purple : "#fff", color: scope === s ? "#fff" : C.purple, fontSize: 13 }}>
            {s} <b>{n}</b>
          </button>
        ))}
        <button onClick={() => load(secret, scope)} style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 20, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>更新</button>
        <button onClick={() => clearOld(7)} style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid " + C.red, color: C.red, background: "#fff", cursor: "pointer" }}>7日より古いを削除</button>
        <button onClick={() => clearOld(0)} style={{ padding: "6px 14px", borderRadius: 20, border: 0, background: C.red, color: "#fff", cursor: "pointer" }}>全削除</button>
      </div>
      {rows.map(r => (
        <div key={r.id} style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: C.purple, borderRadius: 6, padding: "1px 8px" }}>{r.scope}</span>
            {r.code && <span style={{ fontSize: 12, color: C.red }}>code:{r.code}</span>}
            <span style={{ marginLeft: "auto", fontSize: 12, color: C.gray }}>{new Date(r.created_at).toLocaleString("ja-JP")}</span>
          </div>
          <div style={{ fontSize: 13, color: "#111", wordBreak: "break-word" }}>{r.message}</div>
          {r.meta != null && <div style={{ fontSize: 11, color: C.gray, marginTop: 4 }}>{JSON.stringify(r.meta)}</div>}
        </div>
      ))}
      {rows.length === 0 && <p style={{ color: C.gray }}>エラーは記録されていません（健全 or server_errors 未作成）。</p>}
    </div>
  );
}
