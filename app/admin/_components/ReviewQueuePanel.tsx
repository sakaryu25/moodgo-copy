"use client";
import { useState } from "react";
import { ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";

// C-2: AIタグ検証キュー
// 自動タグ付けされたスポットを人がレビュー（承認/タグ修正）する軽量UI

type ReviewItem = {
  id: string;
  name: string;
  address: string | null;
  tags: string[] | null;
  image_url: string | null;
  rating: number | null;
  review_count: number | null;
};

export default function ReviewQueuePanel({ secret }: { secret: string }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [editTags, setEditTags] = useState<Record<string, string[]>>({});
  const [processing, setProcessing] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    setHint("");
    try {
      const res = await fetch(`/api/admin/review-queue?secret=${encodeURIComponent(secret)}&limit=30`);
      const d = await res.json();
      if (d.ok) {
        setItems(d.data);
        if (d.columnMissing) setHint(d.hint);
        const init: Record<string, string[]> = {};
        d.data.forEach((it: ReviewItem) => { init[it.id] = it.tags ?? []; });
        setEditTags(init);
      } else {
        setError(d.error ?? "取得失敗");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const approve = async (id: string, withTags: boolean) => {
    setProcessing(id);
    try {
      const body: Record<string, unknown> = { secret, id };
      if (withTags) body.tags = editTags[id] ?? [];
      const res = await fetch("/api/admin/review-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok) {
        setItems(prev => prev.filter(it => it.id !== id)); // 承認済みはリストから消す
      } else {
        alert(`失敗: ${d.error}`);
      }
    } catch (e) {
      alert(String(e));
    } finally {
      setProcessing(null);
    }
  };

  const toggleTag = (id: string, tag: string) => {
    setEditTags(prev => {
      const cur = prev[id] ?? [];
      return { ...prev, [id]: cur.includes(tag) ? cur.filter(t => t !== tag) : [...cur, tag] };
    });
  };

  return (
    <div style={{ padding: "24px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>✅ AIタグ検証キュー</h2>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: "8px 20px", borderRadius: 8, background: "#ff8f7f", color: "#fff", border: "none", cursor: "pointer", fontSize: 14 }}
        >
          {loading ? "読み込み中..." : "未レビューを読み込む"}
        </button>
      </div>

      {error && <div style={{ color: "#c0385a", marginBottom: 12 }}>{error}</div>}
      {hint && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13, color: "#92600A" }}>
          ⚠️ {hint}
        </div>
      )}

      {items.length === 0 && !loading && (
        <div style={{ color: "#888", padding: "20px 0" }}>
          未レビューのスポットはありません。「未レビューを読み込む」を押してください。
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map(it => (
          <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, background: "#fff" }}>
            <div style={{ display: "flex", gap: 12 }}>
              {it.image_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={it.image_url.includes("/api/photo-proxy") ? it.image_url : `/api/photo-proxy?url=${encodeURIComponent(it.image_url)}`}
                  alt={it.name} style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover" }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{it.name}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{it.address}</div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  ★{it.rating ?? "-"}（{it.review_count ?? 0}件）
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(editTags[it.id] ?? []).map(t => (
                <span key={t} onClick={() => toggleTag(it.id, t)}
                  style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "#ffe9e3", color: "#c0385a", cursor: "pointer" }}>
                  {t} ✕
                </span>
              ))}
              <button onClick={() => setPickerOpen(pickerOpen === it.id ? null : it.id)}
                style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "#f3f4f6", border: "1px dashed #ccc", cursor: "pointer" }}>
                + タグ追加
              </button>
            </div>

            {pickerOpen === it.id && (
              <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ALL_PREDEFINED_TAGS.filter(t => !(editTags[it.id] ?? []).includes(t)).map(t => (
                  <span key={t} onClick={() => toggleTag(it.id, t)}
                    style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, background: "#f3f4f6", cursor: "pointer" }}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={() => approve(it.id, false)} disabled={processing === it.id}
                style={{ flex: 1, padding: "8px", borderRadius: 8, background: "#10b981", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>
                ✅ タグOKで承認
              </button>
              <button onClick={() => approve(it.id, true)} disabled={processing === it.id}
                style={{ flex: 1, padding: "8px", borderRadius: 8, background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>
                ✏️ 修正して承認
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
