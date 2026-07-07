// ─── /api/spot-posts ─────────────────────────────────────────────────────────
// Moodログ投稿（気分ベースの口コミ＝Google口コミの代用）＋投稿写真のスポット写真再利用。
//   POST {action:"create"} … 投稿作成（写真1〜3＋気分タグ＋ひとこと＋誰と＋公開範囲＋権利/再利用チェック＋気分口コミ）
//   POST {action:"react"}  … いいね/参考になった/また行きたい
//   POST {action:"report"} … 通報（閾値で自動非表示）
//   GET  ?placeId=&deviceId= … そのスポットの「みんなのMoodログ」一覧
// 画像は既存 Storage バケット spot-photos に保存し spot_photos(拡張済) に記録。
// ハイブリッド承認: 権利確認OK＋疑い語なし→approvedで即表示／疑わしい→pending／通報3件→hidden。
// 認証はログイン無し＝device_id を「ログイン相当」として必須にする。未適用(テーブル無)でも安全。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findNgWord } from "@/lib/ngwords";

const BUCKET = "spot-photos";
const REPORT_HIDE_THRESHOLD = 3;
const VALID_VISIBILITY = new Set(["private", "group", "spot_public_anonymous", "public"]);
const VALID_RTYPE = new Set(["like", "helpful", "revisit"]);
let bucketEnsured = false;

function isMissingTable(e: { code?: string } | null): boolean {
  return e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST204";
}
function isValidImageBase64(b64: string): boolean {
  const m = b64.match(/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i);
  const payload = m ? b64.slice(b64.indexOf(",") + 1) : b64;
  if (payload.length < 100) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(payload.slice(0, 256));
}
// 権利的に疑わしい＝pending送り（他サイト/Google/SNS転載っぽい文言）
const SUSPICIOUS_RE = /https?:\/\/|www\.|\.com|\.jp\b|google|グーグル|マップ|インスタ|instagram|insta|転載|無断|スクショ|スクリーンショット|screenshot|pinterest|tabelog|食べログ|じゃらん|楽天|ホットペッパー/i;

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "create");

  // ── moderate（管理者: 承認/却下/非表示）────────────────────────────────────────
  if (action === "moderate") {
    if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const postId = String(body?.postId ?? "").trim();
    const status = String(body?.status ?? "");
    if (!postId || !["approved", "rejected", "hidden"].includes(status)) {
      return NextResponse.json({ ok: false, error: "postId と status(approved|rejected|hidden) が必要です" }, { status: 400 });
    }
    try {
      await supabase.from("spot_posts").update({ status }).eq("id", postId).then(() => {}, () => {});
      // 写真の表示可否も投稿に連動（approved=承認済みのみスポット写真候補に残る）
      await supabase.from("spot_photos").update({ moderation_status: status }).eq("post_id", postId).then(() => {}, () => {});
      return NextResponse.json({ ok: true, status });
    } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
  }

  // ── react / report は軽量 ───────────────────────────────────────────────────
  if (action === "react" || action === "report") {
    if (!rateLimit(`spot-post-act:${clientIp(req)}`, 40, 60_000)) {
      return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
    }
    const postId = String(body?.postId ?? "").trim();
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    if (!postId || !deviceId) return NextResponse.json({ ok: false, error: "postId と deviceId が必要です" }, { status: 400 });
    try {
      if (action === "react") {
        const rtype = String(body?.rtype ?? "");
        if (!VALID_RTYPE.has(rtype)) return NextResponse.json({ ok: false, error: "rtype不正" }, { status: 400 });
        const col = rtype === "like" ? "like_count" : rtype === "helpful" ? "helpful_count" : "revisit_count";
        // 解除（トグルoff）: 押していたリアクション行を削除できた時だけカウンタ-1（0未満にしない）。
        //   いいねを押しても解除できない問題(#13)への対応。undo=true で呼ばれる。
        if (body?.undo === true) {
          const { data: del, error: delErr } = await db.from("spot_post_reactions")
            .delete().match({ post_id: postId, device_id: deviceId, rtype }).select("post_id");
          if (delErr && isMissingTable(delErr)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
          if (Array.isArray(del) && del.length > 0) {
            const { data } = await db.from("spot_posts").select(col).eq("id", postId).maybeSingle();
            const cur = (data as Record<string, number> | null)?.[col] ?? 0;
            await db.from("spot_posts").update({ [col]: Math.max(0, cur - 1) }).eq("id", postId).then(() => {}, () => {});
          }
          return NextResponse.json({ ok: true, removed: Array.isArray(del) && del.length > 0 });
        }
        // 付与: 二重防止 unique(post_id,device_id,rtype)。新規挿入できた時だけカウンタ++
        const { error: insErr } = await db.from("spot_post_reactions").insert({ post_id: postId, device_id: deviceId, rtype });
        if (insErr) {
          if (isMissingTable(insErr)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
          // 一意制約違反(23505)=既にリアクション済み → 何もしない
          return NextResponse.json({ ok: true, already: true });
        }
        await db.rpc("increment_spot_post_counter", { p_post: postId, p_col: col }).then(() => {}, async () => {
          // RPC未作成時のフォールバック: read→+1（厳密性は不要な集計値）
          const { data } = await db.from("spot_posts").select(col).eq("id", postId).maybeSingle();
          const cur = (data as Record<string, number> | null)?.[col] ?? 0;
          await db.from("spot_posts").update({ [col]: cur + 1 }).eq("id", postId).then(() => {}, () => {});
        });
        return NextResponse.json({ ok: true });
      }
      // report
      const { data: row } = await db.from("spot_posts").select("report_count").eq("id", postId).maybeSingle();
      const next = ((row as { report_count?: number } | null)?.report_count ?? 0) + 1;
      const patch: Record<string, unknown> = { report_count: next };
      if (next >= REPORT_HIDE_THRESHOLD) patch.status = "hidden";
      await db.from("spot_posts").update(patch).eq("id", postId).then(() => {}, () => {});
      if (next >= REPORT_HIDE_THRESHOLD) {
        await db.from("spot_photos").update({ moderation_status: "hidden" }).eq("post_id", postId).then(() => {}, () => {});
      }
      return NextResponse.json({ ok: true, hidden: next >= REPORT_HIDE_THRESHOLD });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  // ── create（投稿作成）────────────────────────────────────────────────────────
  if (!rateLimit(`spot-post:${clientIp(req)}`, 6, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいて再度お試しください" }, { status: 429 });
  }
  try {
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    if (!deviceId) return NextResponse.json({ ok: false, error: "投稿にはアプリの利用が必要です" }, { status: 401 });

    const placeId = body?.placeId ? String(body.placeId).trim().slice(0, 200) : null;
    const placeName = String(body?.placeName ?? "").trim().slice(0, 200);
    if (!placeId && !placeName) return NextResponse.json({ ok: false, error: "スポット情報が必要です" }, { status: 400 });

    const licenseDeclared = body?.licenseDeclared === true;
    if (!licenseDeclared) {
      return NextResponse.json({ ok: false, error: "自分で撮影した、または使用許可のある写真であることの確認が必要です" }, { status: 400 });
    }
    const caption = String(body?.caption ?? "").trim().slice(0, 300);
    // 価格帯/おすすめ度/連絡先は独立カラム（captionへの文字列埋め込みは廃止・2026-07-06）
    const priceChip = body?.priceChip ? String(body.priceChip).trim().slice(0, 20) : null;
    const priceNote = body?.priceNote ? String(body.priceNote).trim().slice(0, 120) : null;
    const ratingIn = Number(body?.rating);
    const rating = Number.isInteger(ratingIn) && ratingIn >= 1 && ratingIn <= 5 ? ratingIn : null;
    const contact = body?.contact ? String(body.contact).trim().slice(0, 120) : null;
    // NGワードはサーバーでも二重チェック（スポット名・本文・連絡先）
    const ng = findNgWord(caption) || findNgWord(placeName) || (contact ? findNgWord(contact) : null);
    if (ng) return NextResponse.json({ ok: false, error: "不適切な表現が含まれています" }, { status: 400 });

    const rawMoodTags = Array.isArray(body?.moodTags) ? body.moodTags.filter((t: unknown) => typeof t === "string").slice(0, 8) : [];
    // 全投稿にマスト付与する共通タグ（クライアントが送らなくても必ず付く＝直POSTでも抜けない）。
    //   #穴場スポット=みんなの穴場の母集団 / #時間潰し=気分「時間潰し」検索の追加ソース。重複は排除。
    const MANDATORY_TAGS = ["#穴場スポット", "#時間潰し"];
    const moodTags = Array.from(new Set([...rawMoodTags, ...MANDATORY_TAGS]));
    const companion = body?.companion ? String(body.companion).slice(0, 20) : null;
    const posterName = body?.posterName ? String(body.posterName).trim().slice(0, 20) : null;
    let visibility = String(body?.visibility ?? "spot_public_anonymous");
    if (!VALID_VISIBILITY.has(visibility)) visibility = "spot_public_anonymous";
    const groupId = body?.groupId ? String(body.groupId).trim() : null;
    const canUseAsSpotPhoto = body?.canUseAsSpotPhoto !== false;  // 既定OK
    const timeOfDay = body?.timeOfDay ? String(body.timeOfDay).slice(0, 10) : null;
    const wantRevisit = typeof body?.wantRevisit === "boolean" ? body.wantRevisit : null;
    const matchesPhoto = typeof body?.matchesPhoto === "boolean" ? body.matchesPhoto : null;
    // 新スポット投稿用（既存placeなら不要）。placesへ仮登録するための住所・座標。
    const newAddress = body?.address ? String(body.address).trim().slice(0, 300) : null;
    const newLat = typeof body?.lat === "number" ? body.lat : (body?.lat != null && body.lat !== "" ? Number(body.lat) : null);
    const newLng = typeof body?.lng === "number" ? body.lng : (body?.lng != null && body.lng !== "" ? Number(body.lng) : null);
    // 新スポット(穴場)の詳細: 営業時間・最寄駅・期間限定(公開期間)。既存placeでは無視。
    const newOpenHours = body?.openingHours ? String(body.openingHours).trim().slice(0, 400) : null;
    const newStation = body?.station ? String(body.station).trim().slice(0, 100) : null;
    const dateOrNull = (v: unknown): string | null => {
      const s = typeof v === "string" ? v.trim() : "";
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;   // YYYY-MM-DD のみ許可（不正日付は無視）
    };
    const newAvailFrom = dateOrNull(body?.availableFrom);
    const newAvailUntil = dateOrNull(body?.availableUntil);

    const images: string[] = Array.isArray(body?.images) ? body.images.filter((s: unknown) => typeof s === "string").slice(0, 3) : [];
    // フィード用サムネイル（クライアントが400px縮小して送る・任意・imagesと同順）
    const thumbImages: string[] = Array.isArray(body?.thumbImages) ? body.thumbImages.slice(0, 3).map(String) : [];
    for (const img of images) {
      if (img.length > 4_000_000) return NextResponse.json({ ok: false, error: "画像が大きすぎます" }, { status: 400 });
      if (!isValidImageBase64(img)) return NextResponse.json({ ok: false, error: "画像の形式が不正です" }, { status: 400 });
    }

    // ハイブリッド承認: 権利確認OK＋疑い語なし→approved即表示／疑わしい→pending。
    //   private/group は元から公開写真候補にしないので status は approved でも可視範囲で制御。
    const suspicious = SUSPICIOUS_RE.test(caption);
    const status = suspicious ? "pending" : "approved";

    // 画像を Storage に保存
    let uploaded: { url: string; path: string }[] = [];
    if (images.length > 0) {
      if (!bucketEnsured) { await db.storage.createBucket(BUCKET, { public: true }).then(() => {}, () => {}); bucketEnsured = true; }
      const safe = (placeId ?? placeName).replace(/[^0-9a-zA-Z]/g, "").slice(0, 24) || "spot";
      const rand = Math.abs(deviceId.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
      uploaded = (await Promise.all(images.map(async (img, i) => {
        const path = `${safe}/post-${rand}-${img.length}-${i}.jpg`;
        const payload = img.includes(",") ? img.slice(img.indexOf(",") + 1) : img;
        const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(payload, "base64"), { contentType: "image/jpeg", upsert: true });
        if (upErr) return null;
        // フィード用サムネイル: 同名+_thumb.jpg 規約（表示側がURL置換で導出・失敗しても投稿は成功）
        const th = thumbImages[i];
        if (th && isValidImageBase64(th)) {
          const thPayload = th.includes(",") ? th.slice(th.indexOf(",") + 1) : th;
          await db.storage.from(BUCKET)
            .upload(path.replace(/\.jpg$/, "_thumb.jpg"), Buffer.from(thPayload, "base64"), { contentType: "image/jpeg", upsert: true })
            .then(() => {}, () => {});
        }
        const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
        return { url: `${pub.publicUrl}?v=${Buffer.from(path).length}`, path };
      }))).filter(Boolean) as { url: string; path: string }[];
    }

    // 新スポット投稿(place_id無し)は places に仮登録(is_active=false=承認待ち)。admin承認で検索に出る＝穴場の役割を吸収。
    let effectivePlaceId = placeId;
    if (!placeId && placeName) {
      const { data: place } = await db.from("places").insert({
        name: placeName, address: newAddress || "日本", tags: moodTags,
        area: null, nearest_station: newStation, source_type: "user", is_active: false,
        lat: newLat, lng: newLng, open_hours: newOpenHours,
      }).select("id").single();
      if (place && (place as { id?: string }).id) effectivePlaceId = (place as { id: string }).id;
      // 期間限定(公開期間): available_from/until 列が未作成でも投稿は成功させる（列があれば保存）。
      if (effectivePlaceId && (newAvailFrom || newAvailUntil)) {
        await db.from("places").update({ available_from: newAvailFrom, available_until: newAvailUntil })
          .eq("id", effectivePlaceId).then(() => {}, () => {});
      }
    }

    // 本文 insert（価格/おすすめ度/連絡先は独立カラム。列未適用(spot-posts-extra.sql)なら
    //   基本カラムのみで自動リトライ＝投稿自体は失敗させない）
    const baseRow = {
      device_id: deviceId, poster_name: posterName, place_id: effectivePlaceId, place_name: placeName || null,
      caption, mood_tags: moodTags, companion, visibility, group_id: groupId,
      time_of_day: timeOfDay, want_revisit: wantRevisit, matches_photo: matchesPhoto, status,
    };
    let ins = await db.from("spot_posts").insert({
      ...baseRow, price_chip: priceChip, price_note: priceNote, rating, contact,
    }).select("id").single();
    if (ins.error && /price_chip|price_note|rating|contact|42703|column/i.test(String(ins.error.message ?? "") + String((ins.error as { code?: string }).code ?? ""))) {
      ins = await db.from("spot_posts").insert(baseRow).select("id").single();
    }
    const { data: post, error: postErr } = ins;
    if (postErr) {
      if (isMissingTable(postErr)) return NextResponse.json({ ok: false, tableMissing: true, error: "投稿は準備中です（DB更新待ち）" }, { status: 400 });
      throw postErr;
    }
    const postId = (post as { id: string }).id;

    // 写真 insert（spot_photos拡張列を埋める）。public/anon かつ再利用OKのみスポット写真候補。
    if (uploaded.length > 0) {
      const reuseOk = canUseAsSpotPhoto && (visibility === "spot_public_anonymous" || visibility === "public");
      const rows = uploaded.map((u, i) => ({
        post_id: postId, place_id: effectivePlaceId, place_name: placeName || null,
        image_url: u.url, storage_path: u.path, device_id: deviceId,
        photo_source: "user_uploaded", can_use_as_spot_photo: reuseOk,
        license_declared: true, moderation_status: status, is_primary: i === 0, score: 0,
      }));
      await db.from("spot_photos").insert(rows).then(() => {}, () => {});
    }

    return NextResponse.json({ ok: true, id: postId, status });
  } catch (e) {
    console.error("spot-posts POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, posts: [] });
  const db = supabase;
  const { searchParams } = new URL(req.url);

  // admin: pending/全件レビュー
  if (searchParams.get("review") === "1") {
    if (searchParams.get("secret") !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const { data, error } = await db.from("spot_posts").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, posts: [] }); return NextResponse.json({ ok: false, error: error.message }, { status: 500 }); }
    return NextResponse.json({ ok: true, posts: data ?? [] });
  }

  const placeId = searchParams.get("placeId")?.trim();
  const placeName = searchParams.get("placeName")?.trim();
  const deviceId = searchParams.get("deviceId")?.trim() ?? "";
  if (!placeId && !placeName) return NextResponse.json({ ok: true, posts: [] });

  try {
    let q = db.from("spot_posts")
      .select("id, device_id, poster_name, caption, mood_tags, companion, visibility, time_of_day, want_revisit, matches_photo, like_count, helpful_count, revisit_count, created_at")
      .order("created_at", { ascending: false }).limit(50);
    q = placeId ? q.eq("place_id", placeId) : q.eq("place_name", placeName!);
    const { data, error } = await q;
    if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, posts: [] }); throw error; }

    // 可視判定: approved の public/anon は全員、private/group は本人のみ表示（MVP: groupは本人扱い）
    const visible = (data ?? []).filter((p) => {
      const own = deviceId && p.device_id === deviceId;
      const pub = (p as { visibility: string }).visibility === "spot_public_anonymous" || (p as { visibility: string }).visibility === "public";
      return own || pub;
    });
    const ids = visible.map((p) => p.id);

    // 写真（post単位）
    const photosByPost = new Map<string, string[]>();
    if (ids.length > 0) {
      const { data: ph } = await db.from("spot_photos")
        .select("post_id, image_url").in("post_id", ids).neq("moderation_status", "hidden").neq("moderation_status", "rejected");
      for (const r of ph ?? []) {
        const k = (r as { post_id: string }).post_id;
        if (!photosByPost.has(k)) photosByPost.set(k, []);
        photosByPost.get(k)!.push((r as { image_url: string }).image_url);
      }
    }
    // 自分のリアクション状態
    const myReactions = new Set<string>();
    if (deviceId && ids.length > 0) {
      const { data: rx } = await db.from("spot_post_reactions").select("post_id, rtype").in("post_id", ids).eq("device_id", deviceId);
      for (const r of rx ?? []) myReactions.add(`${(r as { post_id: string }).post_id}:${(r as { rtype: string }).rtype}`);
    }

    const posts = visible.map((p) => {
      const anon = (p as { visibility: string }).visibility === "spot_public_anonymous";
      return {
        id: p.id,
        author: anon ? "MoodGoユーザー" : (p.poster_name || "MoodGoユーザー"),
        isOwn: !!deviceId && p.device_id === deviceId,
        caption: p.caption, moodTags: p.mood_tags ?? [], companion: p.companion,
        timeOfDay: p.time_of_day, wantRevisit: p.want_revisit, matchesPhoto: p.matches_photo,
        photos: photosByPost.get(p.id) ?? [],
        likeCount: p.like_count ?? 0, helpfulCount: p.helpful_count ?? 0, revisitCount: p.revisit_count ?? 0,
        myLike: myReactions.has(`${p.id}:like`), myHelpful: myReactions.has(`${p.id}:helpful`), myRevisit: myReactions.has(`${p.id}:revisit`),
        createdAt: p.created_at,
      };
    });
    return NextResponse.json({ ok: true, posts });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
