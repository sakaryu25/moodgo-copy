export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * アプリ内通知（2026-07-08）
 * POST /api/notifications { deviceId, limit? }
 *
 * 専用テーブルを作らず、既存データから「自分に起きたこと」を導出して新着順で返す:
 *   - like    … 自分の投稿への いいね（spot_post_reactions rtype=like）
 *   - visited … 自分の投稿への 行った！（rtype=visited）
 *   - follow  … 新しいフォロワー（user_follows）
 * 未読管理はクライアントが lastSeen をローカル保持して比較する（サーバー状態なし）。
 * ⚠アクター（押した人）は deviceHash と @handle のみ返す。自分自身のリアクションは除外。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, iconPathFor } from "@/lib/device-hash";
import { handlesByDevice } from "@/lib/user-handles";
import { rateLimit, clientIp } from "@/lib/rate-limit";

type Notice = {
  type: "like" | "visited" | "follow";
  at: string;                 // 発生時刻
  spotName?: string;          // 対象投稿名（like/visited）
  targetId?: string;          // 投稿詳細への遷移用（suggestions=UUID / moodlog=ml-UUID）
  actorId?: string | null;    // 押した人の公開ハッシュ
  actorHandle?: string | null;
  actorIcon?: string | null;
};

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, items: [] }, { status: 503 });
  const db = supabase;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 }); }

  const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
  const limit = Math.min(Number(body?.limit ?? 50), 100);
  if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
  if (!rateLimit(`notifications:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }

  try {
    type Row = Record<string, unknown>;
    const myHash = deviceHash(deviceId);

    // ── 自分の投稿（id→名前/種別のマップ）──
    const [mySugs, myMls] = await Promise.all([
      db.from("suggestions").select("id, spot_name, google_place_name").eq("device_id", deviceId).limit(100),
      db.from("spot_posts").select("id, place_name").eq("device_id", deviceId).limit(100),
    ]);
    const nameById = new Map<string, { name: string; targetId: string }>();
    for (const s of (mySugs.data ?? []) as Row[]) {
      nameById.set(String(s.id), { name: String(s.spot_name ?? s.google_place_name ?? "スポット"), targetId: String(s.id) });
    }
    for (const m of (myMls.data ?? []) as Row[]) {
      nameById.set(String(m.id), { name: String(m.place_name ?? "スポット"), targetId: `ml-${m.id}` });
    }
    const myPostIds = [...nameById.keys()];

    // ── リアクション（like/visited）＋ 新フォロワー を並列取得 ──
    const [rxRes, flRes] = await Promise.all([
      myPostIds.length > 0
        ? db.from("spot_post_reactions")
            .select("post_id, device_id, rtype, created_at")
            .in("post_id", myPostIds).in("rtype", ["like", "visited"])
            .order("created_at", { ascending: false }).limit(limit)
        : Promise.resolve({ data: [] as Row[] }),
      (async () => {
        try {
          return await db.from("user_follows")
            .select("follower_hash, created_at")
            .eq("followee_hash", myHash)
            .order("created_at", { ascending: false }).limit(limit);
        } catch { return { data: [] as Row[] }; }
      })(),
    ]);

    // アクターの@handle（リアクションは生device_idを持つのでサーバー内でだけ解決）
    const rx = ((rxRes.data ?? []) as Row[]).filter(r => String(r.device_id ?? "") !== deviceId);  // 自分の操作は除外
    const handleMap = await handlesByDevice(db, rx.map(r => String(r.device_id ?? "")));
    const vHour = Math.floor(Date.now() / 3_600_000);
    const iconFor = (dev: string): string => {
      const { data: pub } = db.storage.from("user-icons").getPublicUrl(iconPathFor(dev));
      return `${pub.publicUrl}?v=${vHour}`;
    };

    const items: Notice[] = [
      ...rx.map((r): Notice => {
        const dev = String(r.device_id ?? "");
        const post = nameById.get(String(r.post_id));
        return {
          type: r.rtype === "visited" ? "visited" : "like",
          at: String(r.created_at ?? ""),
          spotName: post?.name,
          targetId: post?.targetId,
          actorId: dev ? deviceHash(dev) : null,
          actorHandle: dev ? (handleMap.get(dev) ?? null) : null,
          actorIcon: dev ? iconFor(dev) : null,
        };
      }),
      ...(((flRes.data ?? []) as Row[])
        .filter(f => String(f.follower_hash ?? "") !== myHash)
        .map((f): Notice => ({
          type: "follow",
          at: String(f.created_at ?? ""),
          actorId: String(f.follower_hash ?? "") || null,
          actorHandle: null,   // フォローはハッシュのみ保存＝@handleは引けない（プロフィールページで判明）
          actorIcon: null,
        }))),
    ]
      .filter(n => n.at)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[notifications]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, items: [], error: msg }, { status: 500 });
  }
}
