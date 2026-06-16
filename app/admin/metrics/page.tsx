"use client";
// ─── /admin/metrics ───────────────────────────────────────────────────────────
// 検索品質・コストの常設ダッシュボード（#7）。search_metrics を集計して可視化。
//   ・総検索数 / Googleゼロ率（コスト=安いほど良い）/ 平均Google呼び出し数
//   ・気分別の検索数・Googleゼロ率・平均Google呼び出し
import { useCallback, useEffect, useState } from "react";

type MoodRow = { mood: string; searches: number; googleZeroRate: number; avgGoogleCalls: number };
type Data = { ok: boolean; days?: number; totalSearches?: number; googleZeroRate?: number; avgGoogleCallsPerSearch?: number; byMood?: MoodRow[]; tableMissing?: boolean; error?: string };
const C = { purple: "#7C3AED", gray: "#6B7280", bg: "#F7F5FB", green: "#16A34A", amber: "#D97706" };

export default function MetricsAdmin() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (sec: string, d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search-metrics?secret=${encodeURIComponent(sec)}&days=${d}`);
      const j = await res.json();
      if (res.status === 401) { alert("認証エラー"); return; }
      setData(j); setAuthed(true);
    } catch { alert("通信エラー"); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("moodgo-admin-secret") : null;
    if (saved) { setSecret(saved); load(saved, 7); }
  }, [load]);

  if (!authed) {
    return (
      <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, fontFamily: "system-ui" }}>
        <h2 style={{ color: C.purple }}>検索メトリクス</h2>
        <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="admin secret"
          style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd", marginTop: 12 }} />
        <button onClick={() => { localStorage.setItem("moodgo-admin-secret", secret); load(secret, 7); }}
          style={{ width: "100%", padding: 12, marginTop: 12, background: C.purple, color: "#fff", border: 0, borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
          {loading ? "読込中…" : "ログイン"}
        </button>
      </div>
    );
  }

  const card = (label: string, value: string, sub?: string) => (
    <div style={{ flex: 1, background: "#fff", borderRadius: 12, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 12, color: C.gray }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: "#1E0753", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.gray, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: 20, fontFamily: "system-ui", background: C.bg, minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ color: C.purple, margin: 0 }}>検索メトリクス</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[1, 7, 30].map(d => (
            <button key={d} onClick={() => { setDays(d); load(secret, d); }}
              style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid " + C.purple, cursor: "pointer", background: days === d ? C.purple : "#fff", color: days === d ? "#fff" : C.purple, fontWeight: 700 }}>{d}日</button>
          ))}
        </div>
      </div>

      {data?.tableMissing && <p style={{ color: C.amber }}>search_metrics 未作成（supabase/search-metrics.sql を実行してください）。</p>}
      {data?.ok && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            {card("総検索数", `${(data.totalSearches ?? 0).toLocaleString()}`, `直近${data.days}日`)}
            {card("Googleゼロ率", `${data.googleZeroRate ?? 0}%`, "高いほど安い（Supabaseで賄えた割合）")}
            {card("平均Google呼び出し", `${data.avgGoogleCallsPerSearch ?? "-"}`, "1検索あたり（少ないほど安い）")}
          </div>
          <h3 style={{ color: "#3A1D6E", fontSize: 15 }}>気分別</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12, overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#F0EAFB", textAlign: "left" }}>
                <th style={{ padding: 10, fontSize: 13 }}>気分</th>
                <th style={{ padding: 10, fontSize: 13 }}>検索数</th>
                <th style={{ padding: 10, fontSize: 13 }}>Googleゼロ率</th>
                <th style={{ padding: 10, fontSize: 13 }}>平均Google呼び出し</th>
              </tr>
            </thead>
            <tbody>
              {(data.byMood ?? []).map(m => (
                <tr key={m.mood} style={{ borderTop: "1px solid #F0EAFB" }}>
                  <td style={{ padding: 10, fontSize: 13, fontWeight: 700 }}>{m.mood}</td>
                  <td style={{ padding: 10, fontSize: 13 }}>{m.searches.toLocaleString()}</td>
                  <td style={{ padding: 10, fontSize: 13, color: m.googleZeroRate >= 50 ? C.green : C.gray }}>{m.googleZeroRate}%</td>
                  <td style={{ padding: 10, fontSize: 13 }}>{m.avgGoogleCalls}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: C.gray, marginTop: 14 }}>
            ※ CTR/「行った」率など利用者行動の結果別計測は次フェーズ（engagement集計）で追加予定。まずは検索コスト＆Google依存度を可視化。
          </p>
        </>
      )}
    </div>
  );
}
