"use client";
import { useState } from "react";

// C-1: エリア別タグカバレッジ可視化
// Supabase placesテーブルのエリア×ジャンルの登録数ヒートマップ

const AREAS = ["東京", "大阪", "横浜", "名古屋", "福岡", "京都", "神戸", "札幌", "仙台", "広島", "さいたま", "千葉", "川崎"];
const GENRES = [
  "#お腹すいた", "#ラーメン", "#居酒屋", "#和食", "#焼肉", "#カフェスイーツ",
  "#まったりしたい", "#わいわい楽しみたい", "#自然感じたい", "#ドライブしたい",
  "#集中したい", "#体動かしたい", "#温泉", "#ショッピング",
];

type CoverageData = {
  area: string;
  genre: string;
  count: number;
}[];

export default function CoveragePanel({ secret }: { secret: string }) {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/coverage?secret=${encodeURIComponent(secret)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (d.ok) setData(d.data);
      else setError(d.error ?? "取得失敗");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Build lookup map
  const countMap = new Map<string, number>();
  (data ?? []).forEach(({ area, genre, count }) => {
    countMap.set(`${area}:${genre}`, count);
  });

  const maxCount = Math.max(...(data ?? []).map(d => d.count), 1);

  const getColor = (count: number) => {
    if (count === 0) return "#f3f4f6";
    const ratio = Math.min(count / Math.max(maxCount, 10), 1);
    const r = Math.round(255 - ratio * 100);
    const g = Math.round(150 + ratio * 80);
    const b = Math.round(150 - ratio * 100);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div style={{ padding: "24px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>📊 エリア×ジャンル カバレッジ</h2>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: "8px 20px", borderRadius: 8, background: "#ff8f7f",
            color: "#fff", border: "none", cursor: "pointer", fontSize: 14,
          }}
        >
          {loading ? "読み込み中..." : "更新"}
        </button>
      </div>

      {error && <div style={{ color: "#c0385a", marginBottom: 12 }}>{error}</div>}

      {!data && !loading && (
        <div style={{ color: "#888", padding: "20px 0" }}>
          「更新」ボタンを押してカバレッジを読み込んでください。
        </div>
      )}

      {data && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", background: "#f9f9f9", textAlign: "left", whiteSpace: "nowrap", minWidth: 80 }}>
                  エリア＼ジャンル
                </th>
                {GENRES.map(g => (
                  <th key={g} style={{
                    padding: "6px 8px", background: "#f9f9f9", textAlign: "center",
                    writingMode: "vertical-rl", height: 100, whiteSpace: "nowrap", fontSize: 11,
                  }}>
                    {g.replace("#", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AREAS.map(area => (
                <tr key={area}>
                  <td style={{ padding: "6px 12px", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid #eee" }}>
                    {area}
                  </td>
                  {GENRES.map(genre => {
                    const count = countMap.get(`${area}:${genre}`) ?? 0;
                    return (
                      <td key={genre} style={{
                        padding: "6px 8px", textAlign: "center",
                        background: getColor(count),
                        borderBottom: "1px solid #eee",
                        borderRight: "1px solid #eee",
                        minWidth: 40,
                        color: count > 0 ? "#333" : "#bbb",
                      }}>
                        {count}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
            色が濃いほど登録数が多い。0件（灰色）のエリア×ジャンルは手薄な箇所。
          </div>
        </div>
      )}
    </div>
  );
}
