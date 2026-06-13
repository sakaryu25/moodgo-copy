// ─── /api/mood-groups ─────────────────────────────────────────────────────────
// 仲良しグループで「今の気分」をつぶやく機能のAPI。
//
// GET  ?deviceId=xxx                → 自分の所属グループ一覧
// GET  ?groupId=xxx&deviceId=xxx    → グループ詳細（メンバー＋つぶやきフィード）
//
// POST { action: "create", name, nickname, deviceId }       → グループ作成
// POST { action: "join",   code, nickname, deviceId }       → 招待コードで参加
// POST { action: "post",   groupId, deviceId, mood, comment } → 気分をつぶやく
// POST { action: "leave",  groupId, deviceId }               → グループを抜ける

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 紛らわしい文字（0/O, 1/I）を除いた招待コード用文字セット
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = () =>
  Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

export async function GET(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const deviceId = req.nextUrl.searchParams.get("deviceId")?.trim();
  const groupId  = req.nextUrl.searchParams.get("groupId")?.trim();
  if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId必須" }, { status: 400 });

  try {
    if (groupId) {
      // ── グループ詳細（メンバーであることを確認） ──
      const { data: me, error: meErr } = await supabase
        .from("mood_group_members")
        .select("id")
        .eq("group_id", groupId).eq("device_id", deviceId)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) return NextResponse.json({ ok: false, error: "このグループのメンバーではありません" }, { status: 403 });

      const [{ data: group, error: gErr }, { data: members, error: mErr }, { data: posts, error: pErr }] =
        await Promise.all([
          // select("*"): icon列が未作成のDBでもエラーにならない
          supabase.from("mood_groups").select("*").eq("id", groupId).single(),
          supabase.from("mood_group_members").select("device_id, nickname, joined_at").eq("group_id", groupId).order("joined_at"),
          supabase.from("mood_group_posts").select("id, device_id, nickname, mood, comment, spot_name, spot_address, spot_url, created_at")
            .eq("group_id", groupId).order("created_at", { ascending: false }).limit(50),
        ]);
      if (gErr) throw gErr;
      if (mErr) throw mErr;
      if (pErr) throw pErr;

      // 投票・絵文字リアクション（テーブル未作成なら空のまま）
      let reactions: Array<{ post_id: string; device_id: string; rtype: string; value: string }> = [];
      const postIds = (posts ?? []).map(p => p.id);
      if (postIds.length > 0) {
        const { data: rx } = await supabase
          .from("mood_group_reactions")
          .select("post_id, device_id, rtype, value")
          .in("post_id", postIds);
        reactions = rx ?? [];
      }

      // プロフィールアイコン: user-icons/{deviceId}.jpg の公開URLを導出
      // （未設定の人は404になるのでアプリ側で頭文字にフォールバック。?vは1時間単位で更新検知）
      const vHour = Math.floor(Date.now() / 3_600_000);
      const sb = supabase;
      const membersWithIcon = (members ?? []).map(m => {
        const { data: pub } = sb.storage.from("user-icons").getPublicUrl(`${m.device_id}.jpg`);
        return { ...m, icon: `${pub.publicUrl}?v=${vHour}` };
      });

      return NextResponse.json({ ok: true, group, members: membersWithIcon, posts: posts ?? [], reactions });
    }

    // ── 自分の所属グループ一覧 ──
    const { data: memberships, error: msErr } = await supabase
      .from("mood_group_members")
      .select("group_id")
      .eq("device_id", deviceId);
    if (msErr) throw msErr;
    const ids = (memberships ?? []).map(m => m.group_id);
    if (ids.length === 0) return NextResponse.json({ ok: true, groups: [] });

    const [{ data: groups, error: gErr }, { data: allMembers, error: amErr }] = await Promise.all([
      supabase.from("mood_groups").select("*").in("id", ids).order("created_at", { ascending: false }),
      supabase.from("mood_group_members").select("group_id").in("group_id", ids),
    ]);
    if (gErr) throw gErr;
    if (amErr) throw amErr;

    const counts: Record<string, number> = {};
    for (const m of allMembers ?? []) counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;

    // 各グループの最新つぶやき（LINE風の一覧プレビュー用）
    const sb = supabase;
    const lastPosts = await Promise.all(ids.map(async (gid) => {
      const { data } = await sb
        .from("mood_group_posts")
        .select("group_id, nickname, mood, comment, spot_name, created_at")
        .eq("group_id", gid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }));
    const lastByGroup: Record<string, (typeof lastPosts)[number]> = {};
    for (const p of lastPosts) if (p) lastByGroup[p.group_id] = p;

    const enriched = (groups ?? []).map(g => ({
      ...g,
      member_count: counts[g.id] ?? 0,
      last_post: lastByGroup[g.id] ?? null,
    }));
    // 最新の動きがあるグループを上に
    enriched.sort((a, b) =>
      new Date(b.last_post?.created_at ?? b.created_at).getTime() -
      new Date(a.last_post?.created_at ?? a.created_at).getTime());
    return NextResponse.json({ ok: true, groups: enriched });
  } catch (e) {
    console.error("mood-groups GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  try {
    const body = await req.json().catch(() => null);
    if (!body?.action) return NextResponse.json({ ok: false, error: "action必須" }, { status: 400 });
    const deviceId = String(body.deviceId ?? "").trim();
    if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId必須" }, { status: 400 });

    // ── グループ作成 ──
    if (body.action === "create") {
      const name = String(body.name ?? "").trim().slice(0, 30);
      const nickname = String(body.nickname ?? "").trim().slice(0, 20);
      if (!name || !nickname) return NextResponse.json({ ok: false, error: "グループ名とニックネームは必須です" }, { status: 400 });

      // 招待コードの衝突は引き直しでリトライ
      let group = null;
      for (let i = 0; i < 5 && !group; i++) {
        const { data, error } = await supabase
          .from("mood_groups")
          .insert({ name, invite_code: genCode(), created_by: deviceId })
          .select("id, name, invite_code, created_at")
          .single();
        if (!error) group = data;
        else if (!String(error.message).includes("duplicate")) throw error;
      }
      if (!group) return NextResponse.json({ ok: false, error: "コード生成に失敗しました" }, { status: 500 });

      const { error: mErr } = await supabase
        .from("mood_group_members")
        .insert({ group_id: group.id, device_id: deviceId, nickname });
      if (mErr) throw mErr;
      return NextResponse.json({ ok: true, group });
    }

    // ── 招待コードで参加 ──
    if (body.action === "join") {
      const code = String(body.code ?? "").trim().toUpperCase();
      const nickname = String(body.nickname ?? "").trim().slice(0, 20);
      if (!code || !nickname) return NextResponse.json({ ok: false, error: "招待コードとニックネームは必須です" }, { status: 400 });

      const { data: group, error: gErr } = await supabase
        .from("mood_groups")
        .select("id, name, invite_code, created_at")
        .eq("invite_code", code)
        .maybeSingle();
      if (gErr) throw gErr;
      if (!group) return NextResponse.json({ ok: false, error: "招待コードが見つかりません" }, { status: 404 });

      const { error: mErr } = await supabase
        .from("mood_group_members")
        .upsert({ group_id: group.id, device_id: deviceId, nickname }, { onConflict: "group_id,device_id" });
      if (mErr) throw mErr;
      return NextResponse.json({ ok: true, group });
    }

    // ── 気分をつぶやく / スポットを共有 ──
    if (body.action === "post") {
      const groupId     = String(body.groupId ?? "").trim();
      const spotName    = String(body.spotName ?? "").trim().slice(0, 100);
      const spotAddress = String(body.spotAddress ?? "").trim().slice(0, 200);
      const spotUrl     = String(body.spotUrl ?? "").trim().slice(0, 500);
      // スポット共有時は気分なしでもOK
      const comment = String(body.comment ?? "").trim().slice(0, 200);
      // 気分・ひとこと・スポットのいずれかがあれば投稿可（mood列はNOT NULL想定なので空文字で保存）
      const mood = String(body.mood ?? "").trim().slice(0, 20) || (spotName ? "スポット共有" : "");
      if (!groupId || (!mood && !comment)) {
        return NextResponse.json({ ok: false, error: "groupIdと、気分かひとことが必要です" }, { status: 400 });
      }

      const { data: me, error: meErr } = await supabase
        .from("mood_group_members")
        .select("nickname")
        .eq("group_id", groupId).eq("device_id", deviceId)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) return NextResponse.json({ ok: false, error: "このグループのメンバーではありません" }, { status: 403 });

      // asBot: 気分一致のAI提案などをMoodGo名義で投稿（送信者はメンバーであることが条件）
      const nickname = body.asBot === true ? "MoodGo" : me.nickname;

      const { data: post, error: pErr } = await supabase
        .from("mood_group_posts")
        .insert({
          group_id: groupId, device_id: deviceId, nickname, mood,
          comment: comment || null,
          spot_name: spotName || null,
          spot_address: spotAddress || null,
          spot_url: spotUrl || null,
        })
        .select("id, device_id, nickname, mood, comment, spot_name, spot_address, spot_url, created_at")
        .single();
      if (pErr) throw pErr;

      // ── 気分一致の検出 ──
      // 直近2時間の各メンバー最新の気分つぶやきが全員同じならお知らせ（クライアントがAI提案を起動）
      let moodMatch: { mood: string; count: number } | null = null;
      if (!spotName && body.asBot !== true) {
        try {
          const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const [{ data: mems }, { data: recent }] = await Promise.all([
            supabase.from("mood_group_members").select("device_id").eq("group_id", groupId),
            supabase.from("mood_group_posts")
              .select("device_id, mood, nickname, spot_name")
              .eq("group_id", groupId).gte("created_at", since)
              .order("created_at", { ascending: false }).limit(60),
          ]);
          const memberIds = (mems ?? []).map(m => m.device_id);
          if (memberIds.length >= 2) {
            const latestMood = new Map<string, string>();
            for (const p of recent ?? []) {
              if (p.spot_name || p.nickname === "MoodGo") continue;  // スポット共有とAI投稿は除外
              if (!latestMood.has(p.device_id)) latestMood.set(p.device_id, p.mood);
            }
            const moods = memberIds.map(d => latestMood.get(d));
            if (moods.every(m2 => m2 && m2 === mood)) {
              moodMatch = { mood, count: memberIds.length };
            }
          }
        } catch { /* 検出失敗は無視（投稿自体は成功） */ }
      }

      return NextResponse.json({ ok: true, post, moodMatch });
    }

    // ── ニックネーム一括変更（設定画面から。参加中の全グループのメンバー名を更新） ──
    if (body.action === "set_nickname") {
      const nickname = String(body.nickname ?? "").trim().slice(0, 20);
      if (!nickname) return NextResponse.json({ ok: false, error: "nickname必須" }, { status: 400 });
      const { error } = await supabase
        .from("mood_group_members")
        .update({ nickname })
        .eq("device_id", deviceId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // ── 投票（行きたい/微妙）・絵文字リアクション ──
    // 同じ値をもう一度送るとトグルOFF、違う値なら上書き（1投稿につき投票1＋絵文字1）
    if (body.action === "react") {
      const groupId = String(body.groupId ?? "").trim();
      const postId = String(body.postId ?? "").trim();
      const rtype = body.rtype === "vote" ? "vote" : "emoji";
      const value = String(body.value ?? "").trim().slice(0, 16);
      if (!groupId || !postId || !value) {
        return NextResponse.json({ ok: false, error: "groupId/postId/value必須" }, { status: 400 });
      }

      const { data: me, error: meErr } = await supabase
        .from("mood_group_members")
        .select("id")
        .eq("group_id", groupId).eq("device_id", deviceId)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) return NextResponse.json({ ok: false, error: "このグループのメンバーではありません" }, { status: 403 });

      const { data: ex, error: exErr } = await supabase
        .from("mood_group_reactions")
        .select("id, value")
        .eq("post_id", postId).eq("device_id", deviceId).eq("rtype", rtype)
        .maybeSingle();
      if (exErr) {
        // テーブル未作成（supabase/group-features.sql 未実行）
        if (/mood_group_reactions|schema cache|does not exist/i.test(String(exErr.message))) {
          return NextResponse.json({ ok: false, error: "リアクション機能の準備中です（DB更新待ち）" }, { status: 400 });
        }
        throw exErr;
      }

      if (ex && ex.value === value) {
        const { error } = await supabase.from("mood_group_reactions").delete().eq("id", ex.id);
        if (error) throw error;
      } else if (ex) {
        const { error } = await supabase.from("mood_group_reactions").update({ value }).eq("id", ex.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("mood_group_reactions")
          .insert({ post_id: postId, group_id: groupId, device_id: deviceId, rtype, value });
        if (error) {
          if (/mood_group_reactions|schema cache|does not exist/i.test(String(error.message))) {
            return NextResponse.json({ ok: false, error: "リアクション機能の準備中です（DB更新待ち）" }, { status: 400 });
          }
          throw error;
        }
      }
      return NextResponse.json({ ok: true });
    }

    // ── グループアイコン（写真）を設定 ──
    // imageBase64(JPEG) → Supabase Storage(group-icons) → 公開URLを mood_groups.icon に保存
    if (body.action === "set_icon_photo") {
      const groupId = String(body.groupId ?? "").trim();
      const imageBase64 = String(body.imageBase64 ?? "");
      if (!groupId) return NextResponse.json({ ok: false, error: "groupId必須" }, { status: 400 });
      if (!imageBase64) return NextResponse.json({ ok: false, error: "imageBase64必須" }, { status: 400 });
      if (imageBase64.length > 3_000_000) {
        return NextResponse.json({ ok: false, error: "画像が大きすぎます" }, { status: 400 });
      }

      const { data: me, error: meErr } = await supabase
        .from("mood_group_members")
        .select("id")
        .eq("group_id", groupId).eq("device_id", deviceId)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) return NextResponse.json({ ok: false, error: "このグループのメンバーではありません" }, { status: 403 });

      const BUCKET = "group-icons";
      await supabase.storage.createBucket(BUCKET, { public: true }); // 既存ならエラーが返るだけ（無視）
      const path = `${groupId}.jpg`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, Buffer.from(imageBase64, "base64"), { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = `${pub.publicUrl}?v=${Date.now()}`; // 同一パス上書きのためキャッシュバスター付与

      const { error } = await supabase
        .from("mood_groups")
        .update({ icon: url })
        .eq("id", groupId);
      if (error) {
        // icon列が未作成（supabase/group-icon.sql 未実行）の場合
        if (/icon/.test(String(error.message)) && /column|schema/i.test(String(error.message))) {
          return NextResponse.json({ ok: false, error: "アイコン機能の準備中です（DB更新待ち）" }, { status: 400 });
        }
        throw error;
      }
      return NextResponse.json({ ok: true, icon: url });
    }

    // ── グループを抜ける ──
    if (body.action === "leave") {
      const groupId = String(body.groupId ?? "").trim();
      if (!groupId) return NextResponse.json({ ok: false, error: "groupId必須" }, { status: 400 });
      const { error } = await supabase
        .from("mood_group_members")
        .delete()
        .eq("group_id", groupId).eq("device_id", deviceId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "不明なaction" }, { status: 400 });
  } catch (e) {
    console.error("mood-groups POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
