// ── /s/[id] — 投稿の外部共有ページ（OGP付き）──────────────────────────────────
// アプリの「共有」からこのURLを送る。LINE/X等でリンクカード（写真＋スポット名）が展開され、
// 開くと写真・説明＋「アプリで見る」導線のシンプルなページを表示する。
// 対象: suggestions(UUID) / spot_posts(ml-UUID)。非公開・未承認は404相当の案内。
import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const revalidate = 300;   // 5分CDNキャッシュ（共有クリックのバーストに耐える）

type SpotLite = {
  name: string;
  description: string;
  image: string | null;
  prefecture: string;
} | null;

function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}
function toPref(addr: unknown): string {
  const a = String(addr ?? "").replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "");
  const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1] : "";
}
// 旧記法の【目安価格】【おすすめ度】を説明から除去
function cleanDesc(raw: unknown): string {
  return String(raw ?? "")
    .replace(/【目安価格】[^\n]*/g, "")
    .replace(/【おすすめ度】[^\n]*/g, "")
    .trim();
}

async function loadSpot(idParam: string): Promise<SpotLite> {
  if (!supabase) return null;
  const isMoodlog = idParam.startsWith("ml-");
  const realId = isMoodlog ? idParam.slice(3) : idParam;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(realId)) return null;

  try {
    if (isMoodlog) {
      const { data: p } = await supabase.from("spot_posts")
        .select("id, place_name, caption, visibility, status")
        .eq("id", realId).maybeSingle();
      if (!p || p.status !== "approved") return null;
      if (p.visibility !== "public" && p.visibility !== "spot_public_anonymous") return null;
      const { data: phs } = await supabase.from("spot_photos").select("image_url")
        .eq("post_id", realId)
        .neq("moderation_status", "hidden").neq("moderation_status", "rejected").limit(1);
      const img = ((phs ?? []) as Array<{ image_url?: string }>)
        .map(x => String(x.image_url ?? "")).find(u => u && !isLegacyPhotoUrl(u)) ?? null;
      return { name: String(p.place_name ?? "スポット"), description: cleanDesc(p.caption), image: img, prefecture: "" };
    }
    const { data: s } = await supabase.from("suggestions")
      .select("id, spot_name, google_place_name, description, address, image_urls, status")
      .eq("id", realId).maybeSingle();
    if (!s || s.status !== "approved") return null;
    const imgs = ((s.image_urls ?? []) as string[]).filter(u => typeof u === "string" && !isLegacyPhotoUrl(u));
    return {
      name: String(s.spot_name ?? s.google_place_name ?? "スポット"),
      description: cleanDesc(s.description),
      image: imgs[0] ?? null,
      prefecture: toPref(s.address),
    };
  } catch { return null; }
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const spot = await loadSpot(id);
  if (!spot) return { title: "MoodGo — 気分で見つかるおでかけスポット" };
  const title = `${spot.name}${spot.prefecture ? `（${spot.prefecture}）` : ""} | MoodGo`;
  const description = spot.description.slice(0, 90) || "気分で見つかる、みんなの穴場スポット";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      ...(spot.image ? { images: [{ url: spot.image }] } : {}),
    },
    twitter: {
      card: spot.image ? "summary_large_image" : "summary",
      title,
      description,
      ...(spot.image ? { images: [spot.image] } : {}),
    },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spot = await loadSpot(id);

  return (
    <main style={{
      minHeight: "100vh", background: "#F3F1EF", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "-apple-system, 'Hiragino Sans', sans-serif",
    }}>
      <div style={{
        width: "100%", maxWidth: 420, background: "#fff", borderRadius: 24,
        overflow: "hidden", boxShadow: "0 12px 40px rgba(26,19,48,0.12)",
      }}>
        {spot?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={spot.image} alt={spot.name} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{
            width: "100%", aspectRatio: "4/3",
            background: "linear-gradient(135deg,#F472B6,#C084FC,#60A5FA)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 40, fontWeight: 800, letterSpacing: -1,
          }}>MoodGo</div>
        )}
        <div style={{ padding: "20px 22px 24px" }}>
          {spot ? (
            <>
              {spot.prefecture && (
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8B88A6", marginBottom: 4 }}>{spot.prefecture}</div>
              )}
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#1E1548", letterSpacing: -0.3 }}>{spot.name}</h1>
              {spot.description && (
                <p style={{
                  margin: "10px 0 0", fontSize: 14, lineHeight: 1.7, color: "#555",
                  display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>{spot.description}</p>
              )}
            </>
          ) : (
            <>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1E1548" }}>この投稿は見つかりませんでした</h1>
              <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#777" }}>削除されたか、非公開になった可能性があります。</p>
            </>
          )}
          <a
            href="https://apps.apple.com/app/id6784712740"
            style={{
              display: "block", marginTop: 18, textAlign: "center", padding: "14px 16px", borderRadius: 999,
              background: "linear-gradient(90deg,#F56CB3,#9B6BFF,#4FA3FF)",
              color: "#fff", fontSize: 15, fontWeight: 800, textDecoration: "none",
            }}
          >
            MoodGoアプリで見る
          </a>
          <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 11.5, color: "#9A96A8" }}>
            MoodGo — 気分で見つかる、みんなの穴場スポット
          </p>
        </div>
      </div>
    </main>
  );
}
