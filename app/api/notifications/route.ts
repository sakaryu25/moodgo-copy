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
 *   - comment … 自分の投稿への コメント（spot_comments・2026-07-11追加=プッシュと同じイベントをベルにも）
 *   - reply   … 自分のコメントへの 返信（spot_comments.parent_id）
 *   - mention … コメント本文での @自分 メンション
 * 未読管理はクライアントが lastSeen をローカル保持して比較する（サーバー状態なし）。
 * ⚠アクター（押した人）は deviceHash と @handle のみ返す。自分自身のリアクションは除外。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, iconPathFor } from "@/lib/device-hash";
import { handlesByDevice } from "@/lib/user-handles";
import { rateLimit, clientIp } from "@/lib/rate-limit";

type Notice = {
  type: "like" | "visited" | "follow" | "comment" | "reply" | "mention";
  at: string;                 // 発生時刻
  spotName?: string;          // 対象投稿名（like/visited）
  targetId?: string;          // 投稿詳細への遷移用（suggestions=UUID / moodlog=ml-UUID）
  actorId?: string | null;    // 押した人の公開ハッシュ
  actorHandle?: string | null;
  actorIcon?: string | null;
  commentText?: string;       // コメント/返信/メンションの本文（何とコメントしたか・140字まで）
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

    // ── コメント/返信/メンションも導出（プッシュ配信と同じイベントをベルにも出す・2026-07-11統一）──
    //   parent_id/status 列が未適用の環境でも安全（supabaseはエラーをthrowせずdata=nullで返す→空扱い）。
    const safeRows = async (q: PromiseLike<{ data: unknown }>): Promise<Row[]> => {
      try { const { data } = await q; return (data ?? []) as Row[]; } catch { return []; }
    };
    const myHandle = (await handlesByDevice(db, [deviceId])).get(deviceId) ?? null;
    const [cmRowsRaw, myCmRows, mnRowsAll] = await Promise.all([
      myPostIds.length > 0
        ? safeRows(db.from("spot_comments").select("id, post_id, device_id, body, created_at")
            .in("post_id", myPostIds).is("parent_id", null).eq("status", "visible")
            .order("created_at", { ascending: false }).limit(limit))
        : Promise.resolve([] as Row[]),
      safeRows(db.from("spot_comments").select("id").eq("device_id", deviceId)
        .order("created_at", { ascending: false }).limit(200)),
      myHandle
        ? safeRows(db.from("spot_comments").select("id, post_id, device_id, body, created_at")
            .ilike("body", `%@${myHandle}%`).eq("status", "visible")
            .order("created_at", { ascending: false }).limit(limit))
        : Promise.resolve([] as Row[]),
    ]);
    const myCmIds = myCmRows.map((r) => String(r.id));
    const rpRowsRaw = myCmIds.length > 0
      ? await safeRows(db.from("spot_comments").select("id, post_id, device_id, body, created_at")
          .in("parent_id", myCmIds).eq("status", "visible")
          .order("created_at", { ascending: false }).limit(limit))
      : [];
    const notMe = (r: Row) => String(r.device_id ?? "") !== deviceId;
    const cm = cmRowsRaw.filter(notMe);
    const rp = rpRowsRaw.filter(notMe);
    // comment/replyとして出す行はmentionから省く（同じコメントの二重通知防止）
    const seenCmIds = new Set([...cm, ...rp].map((r) => String(r.id)));
    const mn = mnRowsAll.filter(notMe).filter((r) => !seenCmIds.has(String(r.id)));

    // 返信/メンション先の投稿名（自分の投稿以外にも付くので不足分だけ名前を引く）
    const unknownPostIds = [...new Set([...rp, ...mn].map((r) => String(r.post_id ?? "")).filter((pid) => pid && !nameById.has(pid)))];
    if (unknownPostIds.length > 0) {
      const [spRows, sgRows] = await Promise.all([
        safeRows(db.from("spot_posts").select("id, place_name").in("id", unknownPostIds)),
        safeRows(db.from("suggestions").select("id, spot_name, google_place_name").in("id", unknownPostIds)),
      ]);
      for (const m of spRows) nameById.set(String(m.id), { name: String(m.place_name ?? "スポット"), targetId: `ml-${m.id}` });
      for (const sgr of sgRows) {
        if (!nameById.has(String(sgr.id))) nameById.set(String(sgr.id), { name: String(sgr.spot_name ?? sgr.google_place_name ?? "スポット"), targetId: String(sgr.id) });
      }
    }

    // アクターの@handle（リアクション/コメントは生device_idを持つのでサーバー内でだけ解決）
    const rx = ((rxRes.data ?? []) as Row[]).filter(notMe);  // 自分の操作は除外
    const actorDevices = [...new Set([...rx, ...cm, ...rp, ...mn].map(r => String(r.device_id ?? "")).filter(Boolean))];
    const handleMap = await handlesByDevice(db, actorDevices);
    const vHour = Math.floor(Date.now() / 3_600_000);
    const iconFor = (dev: string): string => {
      const { data: pub } = db.storage.from("user-icons").getPublicUrl(iconPathFor(dev));
      return `${pub.publicUrl}?v=${vHour}`;
    };

    // コメント系(comment/reply/mention)をNoticeへ（アクター解決はリアクションと同じ流儀）
    const commentNotice = (type: Notice["type"]) => (r: Row): Notice => {
      const dev = String(r.device_id ?? "");
      const post = nameById.get(String(r.post_id ?? ""));
      return {
        type,
        at: String(r.created_at ?? ""),
        spotName: post?.name,
        targetId: post?.targetId,
        actorId: dev ? deviceHash(dev) : null,
        actorHandle: dev ? (handleMap.get(dev) ?? null) : null,
        actorIcon: dev ? iconFor(dev) : null,
        commentText: String(r.body ?? "").replace(/\s+/g, " ").trim().slice(0, 140) || undefined,
      };
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
      ...cm.map(commentNotice("comment")),
      ...rp.map(commentNotice("reply")),
      ...mn.map(commentNotice("mention")),
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
