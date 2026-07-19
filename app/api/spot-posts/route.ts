// ─── /api/spot-posts ─────────────────────────────────────────────────────────
// Moodログ投稿（気分ベースの口コミ＝Google口コミの代用）＋投稿写真のスポット写真再利用。
//   POST {action:"create"} … 投稿作成（写真1〜3＋気分タグ＋ひとこと＋誰と＋公開範囲＋権利/再利用チェック＋気分口コミ）
//   POST {action:"react"}  … いいね/参考になった/また行きたい
//   POST {action:"report"} … 通報（閾値で自動非表示）
//   GET  ?placeId=&deviceId= … そのスポットの「みんなのMoodログ」一覧
// 画像は既存 Storage バケット spot-photos に保存し spot_photos(拡張済) に記録。
// ハイブリッド承認: 権利確認OK＋疑い語なし→approvedで即表示／疑わしい→pending／通報3件→hidden。
// 認証はログイン無し＝device_id を「ログイン相当」として必須にする。未適用(テーブル無)でも安全。
// 承認モデル(2026-07-08〜): 投稿は即 approved で「全国みんなの穴場」に表示（admin事前承認は廃止）。
//   モデレーションは事後型＝NGワード(投稿時ブロック)＋通報3件で自動非表示＋admin moderateで随時対応。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findNgWord } from "@/lib/ngwords";
import { sendPushToDevice } from "@/lib/push-send";
import { isSameNameLoose } from "@/lib/normalize-name";
import { forwardGeocode } from "@/lib/forward-geocode";

const BUCKET = "spot-photos";
const REPORT_HIDE_THRESHOLD = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANDATORY_TAGS = ["#穴場スポット", "#時間潰し"];   // 全投稿にマスト付与（検索の母集団を保つ）
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
        // 新規いいね時のみ投稿者へプッシュ（/api/spot-like と同一挙動に統一。自分の投稿は除く）
        if (rtype === "like") {
          try {
            const { data: owner } = await db.from("spot_posts").select("device_id").eq("id", postId).maybeSingle();
            const ownerId = (owner as { device_id?: string } | null)?.device_id;
            if (ownerId && ownerId !== deviceId) {
              await sendPushToDevice(ownerId, { title: "MoodGo", body: "あなたの投稿にいいねがつきました", data: { type: "like", postId: `ml-${postId}` } });
            }
          } catch { /* 通知失敗は無視 */ }
        }
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
        // (A)事後モデレーション: 即公開に伴い、通報3件でこの投稿由来の「ユーザー作成スポット」は検索からも外す(is_active=false)。
        //   共有スポット(Google/admin/OSM)は投稿への通報で消さない＝source_type=user のみ対象（誤爆防止）。adminがpending-spotsで再開可。
        try {
          const { data: pr } = await db.from("spot_posts").select("place_id").eq("id", postId).maybeSingle();
          const pid = (pr as { place_id?: string } | null)?.place_id;
          if (pid) await db.from("places").update({ is_active: false }).eq("id", pid).eq("source_type", "user").then(() => {}, () => {});
        } catch { /* place無効化失敗は投稿hideを妨げない */ }
      }
      return NextResponse.json({ ok: true, hidden: next >= REPORT_HIDE_THRESHOLD });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  // ── 本人の投稿: 判定 / 取得(編集prefill) / 更新 / 削除（device_id一致のみ）──────
  //   deviceId は資格情報のため body で受け、レスポンスには生値を出さない。
  if (action === "is-mine" || action === "get-mine" || action === "update" || action === "delete") {
    if (!rateLimit(`spot-post-own:${clientIp(req)}`, 40, 60_000)) {
      return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
    }
    const postId = String(body?.postId ?? "").trim().replace(/^ml-/, "");
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    if (!UUID_RE.test(postId) || !deviceId) return NextResponse.json({ ok: false, error: "パラメータが不正です" }, { status: 400 });
    try {
      // 所有者確認（生device_idはレスポンスに出さない）
      const { data: own } = await db.from("spot_posts").select("device_id").eq("id", postId).maybeSingle();
      if (!own) return NextResponse.json({ ok: true, mine: false, notFound: true });
      const mine = String((own as { device_id?: string }).device_id ?? "") === deviceId;

      if (action === "is-mine") return NextResponse.json({ ok: true, mine });
      if (!mine) return NextResponse.json({ ok: false, error: "この投稿を操作する権限がありません" }, { status: 403 });

      // ── 編集フォームのプレフィル用（本人のみ・写真URLも返す）──
      if (action === "get-mine") {
        const FULL = "id, place_id, place_name, caption, mood_tags, visibility, rating, price_chip, price_note, contact";
        let { data: p, error } = await db.from("spot_posts").select(FULL).eq("id", postId).maybeSingle();
        if (error && (error as { code?: string }).code === "42703") {
          ({ data: p } = await db.from("spot_posts").select("id, place_id, place_name, caption, mood_tags, visibility").eq("id", postId).maybeSingle());
        }
        const { data: phs } = await db.from("spot_photos").select("image_url").eq("post_id", postId)
          .neq("moderation_status", "hidden").neq("moderation_status", "rejected");
        const photos = ((phs ?? []) as Array<{ image_url?: string }>).map((x) => String(x.image_url ?? "")).filter(Boolean);
        const row = (p ?? {}) as Record<string, unknown>;
        // 紐づく場所(places)の住所/営業時間/最寄駅/期間も返す（ユーザー作成スポットのみ編集可）。
        const placeId = row.place_id ? String(row.place_id) : "";
        let address = "", openingHours = "", station = "", availableFrom = "", availableUntil = "", placeEditable = false;
        if (placeId) {
          const PLFULL = "address, open_hours, nearest_station, source_type, available_from, available_until";
          let plq = await db.from("places").select(PLFULL).eq("id", placeId).maybeSingle();
          if (plq.error && (plq.error as { code?: string }).code === "42703") {
            plq = await db.from("places").select("address, open_hours, nearest_station, source_type").eq("id", placeId).maybeSingle();
          }
          const plr = (plq.data ?? {}) as Record<string, unknown>;
          address = String(plr.address ?? "");
          openingHours = String(plr.open_hours ?? "");
          station = String(plr.nearest_station ?? "");
          availableFrom = String(plr.available_from ?? "").slice(0, 10);
          availableUntil = String(plr.available_until ?? "").slice(0, 10);
          placeEditable = String(plr.source_type ?? "") === "user";   // 自分で作った穴場だけ場所情報を編集可
        }
        return NextResponse.json({ ok: true, mine: true, post: {
          id: postId,
          placeId,
          placeName: String(row.place_name ?? ""),
          caption: String(row.caption ?? ""),
          moodTags: Array.isArray(row.mood_tags) ? row.mood_tags : [],
          visibility: String(row.visibility ?? "spot_public_anonymous"),
          rating: typeof row.rating === "number" ? row.rating : 0,
          priceChip: (row.price_chip as string | null) ?? "",
          priceNote: (row.price_note as string | null) ?? "",
          contact: (row.contact as string | null) ?? "",
          address, openingHours, station, availableFrom, availableUntil, placeEditable,
          photos,
        } });
      }

      // ── 削除（本人のみ）: 写真・リアクションも巻き取ってから本文を削除 ──
      if (action === "delete") {
        // 削除前に紐づく place_id を控える（投稿のみで作られた孤立placeの掃除判定用）
        const { data: pre } = await db.from("spot_posts").select("place_id").eq("id", postId).maybeSingle();
        const delPlaceId = (pre as { place_id?: string } | null)?.place_id ?? null;
        await db.from("spot_photos").delete().eq("post_id", postId).then(() => {}, () => {});
        await db.from("spot_post_reactions").delete().eq("post_id", postId).then(() => {}, () => {});
        const { error } = await db.from("spot_posts").delete().match({ id: postId, device_id: deviceId });
        if (error) throw error;
        // 投稿のみで作られた user place が、この削除で投稿ゼロになったら place も消す（孤立掃除）。
        //   他の投稿が残っている / 取り込み・Google由来(source_type!=user) は消さない。
        if (delPlaceId) {
          try {
            const { data: pl } = await db.from("places").select("source_type").eq("id", delPlaceId).maybeSingle();
            if (String((pl as { source_type?: string } | null)?.source_type ?? "") === "user") {
              const { count } = await db.from("spot_posts").select("id", { count: "exact", head: true }).eq("place_id", delPlaceId);
              if ((count ?? 0) === 0) {
                await db.from("spot_photos").delete().eq("place_id", delPlaceId).then(() => {}, () => {});
                await db.from("spot_ratings").delete().eq("place_id", delPlaceId).then(() => {}, () => {});
                await db.from("places").delete().eq("id", delPlaceId).then(() => {}, () => {});
              }
            }
          } catch { /* 掃除失敗は削除成功を妨げない */ }
        }
        return NextResponse.json({ ok: true, deleted: true });
      }

      // ── 更新（本人のみ・名前/本文/気分タグ/公開範囲/評価/価格/連絡先。NGワード再チェック）──
      const caption = String(body?.caption ?? "").trim().slice(0, 300);
      const placeName = body?.placeName != null ? String(body.placeName).trim().slice(0, 200) : null;
      if (findNgWord(caption) || (placeName && findNgWord(placeName))) return NextResponse.json({ ok: false, error: "不適切な表現が含まれています" }, { status: 400 });
      const rawTags = Array.isArray(body?.moodTags) ? body.moodTags.filter((t: unknown) => typeof t === "string").slice(0, 8) : [];
      const moodTags = Array.from(new Set([...(rawTags as string[]), ...MANDATORY_TAGS]));
      const ratingIn = Number(body?.rating);
      const rating = Number.isInteger(ratingIn) && ratingIn >= 1 && ratingIn <= 5 ? ratingIn : null;
      const priceChip = body?.priceChip ? String(body.priceChip).trim().slice(0, 20) : null;
      const priceNote = body?.priceNote ? String(body.priceNote).trim().slice(0, 120) : null;
      const contact = body?.contact ? String(body.contact).trim().slice(0, 120) : null;
      let visibility: string | null = body?.visibility != null ? String(body.visibility) : null;
      if (visibility && !VALID_VISIBILITY.has(visibility)) visibility = null;
      // 名前/公開範囲は基本カラム＝extra列未適用でも必ず保存する（base に含める）
      const base: Record<string, unknown> = { caption, mood_tags: moodTags };
      if (placeName) base.place_name = placeName;
      if (visibility) base.visibility = visibility;
      const full = { ...base, rating, price_chip: priceChip, price_note: priceNote, contact };
      // extra列(spot-posts-extra.sql)未適用時は42703 → 基本列のみで再試行（更新自体は失敗させない）
      let { error } = await db.from("spot_posts").update(full).match({ id: postId, device_id: deviceId });
      if (error && /price_chip|price_note|rating|contact|42703|column/i.test(String(error.message ?? "") + String((error as { code?: string }).code ?? ""))) {
        ({ error } = await db.from("spot_posts").update(base).match({ id: postId, device_id: deviceId }));
      }
      if (error) throw error;

      // ── 写真の削除（編集で外した既存写真）: image_url一致で spot_photos と Storage を掃除（本人=L144で確認済み）──
      const removeUrls: string[] = Array.isArray(body?.removePhotoUrls)
        ? (body.removePhotoUrls as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 30)
        : [];
      if (removeUrls.length > 0) {
        const { data: delRows } = await db.from("spot_photos")
          .select("storage_path").eq("post_id", postId).in("image_url", removeUrls);
        const paths = ((delRows ?? []) as Array<{ storage_path?: string }>)
          .map((r) => String(r.storage_path ?? "")).filter(Boolean);
        if (paths.length > 0) {
          // 本体＋サムネ(_thumb)の両方を消す（add-photo と同じ命名規約）
          const withThumbs = paths.flatMap((p) => [p, p.replace(/(\.[a-z0-9]+)$/i, "_thumb$1")]);
          await db.storage.from(BUCKET).remove(withThumbs).then(() => {}, () => {});
        }
        await db.from("spot_photos").delete().eq("post_id", postId).in("image_url", removeUrls).then(() => {}, () => {});
      }

      // ── 紐づく場所(places)の 住所/営業時間/最寄駅/期間 も更新（自分で作った穴場=source_type:user のみ）──
      //   共有の既存place(Google/admin)は壊さないため source_type を確認してから更新する。
      const newAddress = body?.address != null ? String(body.address).trim().slice(0, 300) : null;
      const newHours = body?.openingHours != null ? String(body.openingHours).trim().slice(0, 400) : null;
      const newStation = body?.station != null ? String(body.station).trim().slice(0, 100) : null;
      const newAvailFrom = body?.availableFrom != null ? String(body.availableFrom).trim().slice(0, 20) : null;
      const newAvailUntil = body?.availableUntil != null ? String(body.availableUntil).trim().slice(0, 20) : null;
      if (newAddress !== null || newHours !== null || newStation !== null || newAvailFrom !== null || newAvailUntil !== null) {
        const { data: post2 } = await db.from("spot_posts").select("place_id").eq("id", postId).maybeSingle();
        const pid = (post2 as { place_id?: string } | null)?.place_id;
        if (pid) {
          const { data: pl } = await db.from("places").select("source_type").eq("id", pid).maybeSingle();
          if (String((pl as { source_type?: string } | null)?.source_type ?? "") === "user") {
            const placePatch: Record<string, unknown> = {};
            if (newAddress !== null) placePatch.address = newAddress || "日本";
            if (newHours !== null) placePatch.open_hours = newHours || null;
            if (newStation !== null) placePatch.nearest_station = newStation || null;
            if (Object.keys(placePatch).length > 0) await db.from("places").update(placePatch).eq("id", pid).then(() => {}, () => {});
            // 期間(available_from/until)は列未適用でも投稿更新は失敗させない
            if (newAvailFrom !== null || newAvailUntil !== null) {
              const periodPatch: Record<string, unknown> = {};
              if (newAvailFrom !== null) periodPatch.available_from = newAvailFrom || null;
              if (newAvailUntil !== null) periodPatch.available_until = newAvailUntil || null;
              await db.from("places").update(periodPatch).eq("id", pid).then(() => {}, () => {});
            }
          }
        }
      }
      return NextResponse.json({ ok: true, updated: true });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String((e as { message?: string })?.message ?? e) }, { status: 500 });
    }
  }

  // ── add-photo（本人の投稿に写真を1枚追記）──────────────────────────────────────
  //   画像上限なし対応: create は1枚だけ送り、残りはこのアクションで1枚ずつ追記する
  //   （全画像を1リクエストのbase64で送るとVercelのボディ上限を超えるため分割）。本人のみ。
  if (action === "add-photo") {
    if (!rateLimit(`spot-post-photo:${clientIp(req)}`, 120, 60_000)) {
      return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
    }
    const postId = String(body?.postId ?? "").trim().replace(/^ml-/, "");
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    if (!UUID_RE.test(postId) || !deviceId) return NextResponse.json({ ok: false, error: "パラメータが不正です" }, { status: 400 });
    const image = typeof body?.image === "string" ? body.image : "";
    const thumb = typeof body?.thumbImage === "string" ? body.thumbImage : "";
    if (!image || image.length > 4_000_000 || !isValidImageBase64(image)) {
      return NextResponse.json({ ok: false, error: "画像の形式が不正です" }, { status: 400 });
    }
    try {
      // 所有者確認＋追記に必要な投稿属性を取得（本人のみ・生device_idは返さない）
      const { data: post } = await db.from("spot_posts")
        .select("device_id, place_id, place_name, visibility, status").eq("id", postId).maybeSingle();
      if (!post) return NextResponse.json({ ok: false, error: "投稿が見つかりません" }, { status: 404 });
      const p = post as { device_id?: string; place_id?: string | null; place_name?: string | null; visibility?: string; status?: string };
      if (String(p.device_id ?? "") !== deviceId) return NextResponse.json({ ok: false, error: "権限がありません" }, { status: 403 });

      if (!bucketEnsured) { await db.storage.createBucket(BUCKET, { public: true }).then(() => {}, () => {}); bucketEnsured = true; }
      const safe = String(p.place_id ?? p.place_name ?? "spot").replace(/[^0-9a-zA-Z]/g, "").slice(0, 24) || "spot";
      const rand = Math.abs(deviceId.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
      const path = `${safe}/post-${rand}-${image.length}-x${Date.now()}.jpg`;
      const payload = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(payload, "base64"), { contentType: "image/jpeg", upsert: true });
      if (upErr) return NextResponse.json({ ok: false, error: "画像の保存に失敗しました" }, { status: 500 });
      if (thumb && isValidImageBase64(thumb)) {
        const thPayload = thumb.includes(",") ? thumb.slice(thumb.indexOf(",") + 1) : thumb;
        await db.storage.from(BUCKET).upload(path.replace(/\.jpg$/, "_thumb.jpg"), Buffer.from(thPayload, "base64"), { contentType: "image/jpeg", upsert: true }).then(() => {}, () => {});
      }
      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
      const url = `${pub.publicUrl}?v=${Buffer.from(path).length}`;
      const reuseOk = p.visibility === "spot_public_anonymous" || p.visibility === "public";
      await db.from("spot_photos").insert({
        post_id: postId, place_id: p.place_id ?? null, place_name: p.place_name ?? null,
        image_url: url, storage_path: path, device_id: deviceId,
        photo_source: "user_uploaded", can_use_as_spot_photo: reuseOk,
        license_declared: true, moderation_status: p.status ?? "approved", is_primary: false, score: 0,
      }).then(() => {}, () => {});
      return NextResponse.json({ ok: true, url });
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
    // 全投稿にマスト付与する共通タグ（モジュール定数 MANDATORY_TAGS。直POSTでも抜けない）。
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
    // 限定イベント派生スポット: 「イベント名＠元スポット」を元スポットと同じ場所に作る際、
    //   位置(住所/座標)を継承する親スポットID。元データ(親)は一切変更しない。
    const parentPlaceId = body?.parentPlaceId ? String(body.parentPlaceId).trim().slice(0, 200) : null;

    const images: string[] = Array.isArray(body?.images) ? body.images.filter((s: unknown) => typeof s === "string").slice(0, 3) : [];
    // フィード用サムネイル（クライアントが400px縮小して送る・任意・imagesと同順）
    const thumbImages: string[] = Array.isArray(body?.thumbImages) ? body.thumbImages.slice(0, 3).map(String) : [];
    for (const img of images) {
      if (img.length > 4_000_000) return NextResponse.json({ ok: false, error: "画像が大きすぎます" }, { status: 400 });
      if (!isValidImageBase64(img)) return NextResponse.json({ ok: false, error: "画像の形式が不正です" }, { status: 400 });
    }

    // 即時公開: すべての投稿を approved にして「全国みんなの穴場」へ即反映（admin事前承認は廃止）。
    //   安全側の担保は事後型＝NGワード(上でブロック済)＋通報3件で自動非表示＋admin moderateで随時。
    //   private/group は元から公開写真候補にしないので status=approved でも可視範囲(visibility)で制御。
    const status = "approved";

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
    let linkedExistingName: string | null = null;   // A+C重複防止で既存placeに紐付けた場合の名前
    if (!placeId && placeName) {
      // 限定イベント派生スポットは親スポットの位置を継承（クライアントは座標を持たないため）。
      let insLat = newLat, insLng = newLng, insAddr = newAddress, insHours = newOpenHours, insStation = newStation;
      if (parentPlaceId) {
        const { data: pp } = await db.from("places").select("address, lat, lng, open_hours, nearest_station").eq("id", parentPlaceId).maybeSingle();
        const p2 = pp as { address?: string | null; lat?: number | null; lng?: number | null; open_hours?: string | null; nearest_station?: string | null } | null;
        if (p2) {
          if (insLat == null) insLat = p2.lat ?? null;
          if (insLng == null) insLng = p2.lng ?? null;
          if (!insAddr) insAddr = p2.address ?? null;
          // 期間限定イベントの営業時間/最寄駅も親スポットから継承（未入力なら）＝詳細が空にならない
          if (!insHours) insHours = p2.open_hours ?? null;
          if (!insStation) insStation = p2.nearest_station ?? null;
        }
      }
      // 座標が無い新スポットは住所(無ければ名前)から順ジオコーディングで座標を補完する。
      //   利用者には見せない内部データ＝距離計算・下の重複防止・検索対象化に効く（要望: 住所と名前から座標補完）。
      //   イベント派生(parentPlaceId)は親から継承済みなのでスキップ。
      if (!parentPlaceId && (insLat == null || insLng == null)) {
        const geo = (insAddr ? await forwardGeocode(insAddr) : null) ?? (placeName ? await forwardGeocode(placeName) : null);
        if (geo) { insLat = geo.lat; insLng = geo.lng; }
      }
      // ── A+C 重複防止（イベント派生・期間限定以外・座標がある時）──
      //   同じ物理的な場所は座標がほぼ同じ＝表記ゆれ(カナ/英語)の別名でも二重作成しない。
      //   ①表記ゆれ範囲で名前一致 or ②±~30mに既存が1件だけ（＝同一地点の別表記）→ その既存placeに紐付ける。
      //   ⚠ 期間限定(availableFrom/Until あり)は「同じ場所の一時イベント」＝恒久placeとは別物なので絶対に
      //     紐付けない（紐付けると期間限定の写真が恒久スポットに混ざり“差別化できない”状態になる）。
      //     イベント派生(parentPlaceId)も同様に除外＝どの入口でも期間限定は必ず独立スポットになる（統一）。
      if (!parentPlaceId && !newAvailFrom && !newAvailUntil && insLat != null && insLng != null) {
        const dLat = 0.0009, dLng = 0.0011;   // 検索窓 ~100m
        const { data: near } = await db.from("places")
          .select("id, name, lat, lng")
          .eq("is_active", true)   // 非アクティブ(削除済み)行に紐付けると投稿が見えなくなる
          .gte("lat", insLat - dLat).lte("lat", insLat + dLat)
          .gte("lng", insLng - dLng).lte("lng", insLng + dLng).limit(60);
        const rows = (near ?? []) as Array<{ id: string; name?: string; lat?: number; lng?: number }>;
        let dup = rows.find((p) => isSameNameLoose(placeName, String(p.name ?? "")));
        if (!dup) {
          // 名前一致が無くても至近が1件だけなら同一地点の別表記(英語/カナ)とみなす（複数=別POIの恐れ→紐付けない）
          const veryNear = rows.filter((p) =>
            Math.abs(Number(p.lat) - (insLat as number)) < 0.0003 && Math.abs(Number(p.lng) - (insLng as number)) < 0.0004);
          if (veryNear.length === 1) dup = veryNear[0];
        }
        if (dup?.id) { effectivePlaceId = dup.id; linkedExistingName = String(dup.name ?? "") || null; }
      }
      // R2: 座標一致で見つからなくても、名前が既存placeと完全一致するなら二重作成しない。
      //   （検索の「これかも？」候補を選ばず同名を手入力したケースの重複を防ぐ）。同名が1件＝それに
      //   紐付け／複数(チェーン)は座標最寄りを採用／座標も無ければ曖昧なので新規作成に委ねる。
      if (!effectivePlaceId && !parentPlaceId && !newAvailFrom && !newAvailUntil && placeName.trim().length >= 2) {
        const { data: byName } = await db.from("places")
          .select("id, name, lat, lng").eq("name", placeName.trim())
          .eq("is_active", true)   // 非アクティブ行に紐付けると投稿が見えなくなる
          .limit(20);
        const rows = (byName ?? []) as Array<{ id: string; name?: string; lat?: number | null; lng?: number | null }>;
        let dup: { id: string; name?: string } | null = null;
        if (rows.length === 1) dup = rows[0];
        else if (rows.length > 1 && insLat != null && insLng != null) {
          let bestD = Infinity;
          for (const p of rows) {
            if (p.lat == null || p.lng == null) continue;
            const d = Math.abs(Number(p.lat) - (insLat as number)) + Math.abs(Number(p.lng) - (insLng as number));
            if (d < bestD) { bestD = d; dup = p; }
          }
        }
        if (dup?.id) { effectivePlaceId = dup.id; linkedExistingName = String(dup.name ?? "") || null; }
      }
      // 新規placeを登録。
      //   (A) 2026-07-19: 新規ユーザースポットも「即検索公開」＝完全な事後モデレーション（NGワードで投稿時ブロック＋
      //     通報3件で自動非表示＋coreName dedup＋adminで随時deactivate）。投稿の達成感を優先しMoodGoの穴場文化を育てる。
      //   ただし座標が無いと find_nearby に出ないため、座標がある時だけ is_active=true。座標無し（geocode失敗等）は
      //     is_active=false で pending-spots(承認待ち)に回し、adminが座標を補って承認する（＝旧来の承認導線を維持）。
      //   期間限定イベント派生(parentPlaceId＋終了日)は従来どおり期間中だけ検索に出す。cron/cleanup-stale-cacheが期限切れ削除。
      if (!effectivePlaceId) {
        const hasCoords = typeof insLat === "number" && Number.isFinite(insLat) && typeof insLng === "number" && Number.isFinite(insLng);
        const eventActive = !!(parentPlaceId && newAvailUntil);
        const { data: place } = await db.from("places").insert({
          name: placeName, address: insAddr || "日本", tags: moodTags,
          area: null, nearest_station: insStation, source_type: "user", is_active: hasCoords || eventActive,
          lat: insLat, lng: insLng, open_hours: insHours,
        }).select("id").single();
        if (place && (place as { id?: string }).id) effectivePlaceId = (place as { id: string }).id;
        // 期間限定(公開期間): available_from/until 列が未作成でも投稿は成功させる（列があれば保存）。
        if (effectivePlaceId && (newAvailFrom || newAvailUntil)) {
          await db.from("places").update({ available_from: newAvailFrom, available_until: newAvailUntil })
            .eq("id", effectivePlaceId).then(() => {}, () => {});
        }
      }
    }

    // ── 2b: 既存スポットへの投稿で「住所/営業時間/最寄駅」が未登録なら投稿者入力で補完（空の項目だけ・上書きしない）──
    if (placeId && body?.completePlace) {
      try {
        const { data: cur } = await db.from("places")
          .select("address, open_hours, nearest_station").eq("id", placeId).maybeSingle();
        const c = (cur ?? {}) as { address?: string | null; open_hours?: string | null; nearest_station?: string | null };
        const addrEmpty = (a?: string | null) => {
          const s = String(a ?? "").trim().replace(/^日本[、,\s]*/, "");
          return !s || s === "日本" || /^(北海道|東京都|京都府|大阪府|.{2,3}県)$/.test(s);
        };
        const patch: Record<string, unknown> = {};
        if (newAddress && addrEmpty(c.address)) patch.address = newAddress;
        if (newOpenHours && !String(c.open_hours ?? "").trim()) patch.open_hours = newOpenHours;
        if (newStation && !String(c.nearest_station ?? "").trim()) patch.nearest_station = newStation;
        if (Object.keys(patch).length > 0) await db.from("places").update(patch).eq("id", placeId).then(() => {}, () => {});
      } catch { /* 補完失敗は投稿成立を妨げない */ }
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

    return NextResponse.json({ ok: true, id: postId, status, linkedTo: linkedExistingName });
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

  const LIST_COLS = "id, device_id, poster_name, caption, mood_tags, companion, visibility, time_of_day, want_revisit, matches_photo, like_count, helpful_count, revisit_count, created_at";

  try {
    // ── 期間限定イベント派生スポット("イベント名＠この場所")の投稿も親のMoodログに含める（2026-07-14）──
    //   派生スポットは親と同じ場所（座標/住所を継承）なので、名前サフィックス一致＋
    //   座標近接(≦200m・両方に座標がある時のみ確認)で同一地点と判定して束ねる。
    //   ※place-events APIと同じ like("%＠親名") パターン。親名に＠を含む(=自身が派生)場合はスキップ。
    let parentName = placeName ?? "";
    let pLat: number | null = null, pLng: number | null = null;
    if (placeId) {
      const { data: pl } = await db.from("places").select("name, lat, lng").eq("id", placeId).maybeSingle();
      const p = pl as { name?: string | null; lat?: number | null; lng?: number | null } | null;
      if (p?.name) parentName = String(p.name);
      pLat = typeof p?.lat === "number" ? p.lat : null;
      pLng = typeof p?.lng === "number" ? p.lng : null;
    }
    const derivedIds: string[] = [];
    if (parentName && parentName.length >= 2 && !parentName.includes("＠")) {
      const safe = parentName.replace(/[%_,]/g, "").slice(0, 80);
      const { data: kids } = await db.from("places")
        .select("id, lat, lng").eq("source_type", "user").eq("is_active", true).like("name", `%＠${safe}`).limit(20);
      for (const k of (kids ?? []) as Array<{ id: string; lat: number | null; lng: number | null }>) {
        if (pLat != null && pLng != null && k.lat != null && k.lng != null) {
          const dLat = (k.lat - pLat) * 111000, dLng = (k.lng - pLng) * 91000;
          if (Math.hypot(dLat, dLng) > 200) continue;   // 別地域の同名スポットへの誤混入防止
        }
        derivedIds.push(String(k.id));
      }
    }

    let q = db.from("spot_posts")
      .select(LIST_COLS)
      .order("created_at", { ascending: false }).limit(50);
    q = placeId ? q.eq("place_id", placeId) : q.eq("place_name", placeName!);
    const { data, error } = await q;
    if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, posts: [] }); throw error; }

    // 派生スポットの投稿をマージ（新しい順に統合して上限50件）
    let rows = data ?? [];
    if (derivedIds.length > 0) {
      const { data: extra } = await db.from("spot_posts")
        .select(LIST_COLS).in("place_id", derivedIds)
        .order("created_at", { ascending: false }).limit(50);
      const seen = new Set(rows.map((r) => String((r as { id: string }).id)));
      for (const r of (extra ?? []) as typeof rows) {
        if (!seen.has(String((r as { id: string }).id))) rows.push(r);
      }
      rows.sort((a, b) => String((b as { created_at?: string }).created_at ?? "").localeCompare(String((a as { created_at?: string }).created_at ?? "")));
      rows = rows.slice(0, 50);
    }

    // 可視判定: approved の public/anon は全員、private/group は本人のみ表示（MVP: groupは本人扱い）
    const visible = rows.filter((p) => {
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
