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
          supabase.from("mood_groups").select("id, name, invite_code, created_at").eq("id", groupId).single(),
          supabase.from("mood_group_members").select("device_id, nickname, joined_at").eq("group_id", groupId).order("joined_at"),
          supabase.from("mood_group_posts").select("id, device_id, nickname, mood, comment, created_at")
            .eq("group_id", groupId).order("created_at", { ascending: false }).limit(50),
        ]);
      if (gErr) throw gErr;
      if (mErr) throw mErr;
      if (pErr) throw pErr;
      return NextResponse.json({ ok: true, group, members: members ?? [], posts: posts ?? [] });
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
      supabase.from("mood_groups").select("id, name, invite_code, created_at").in("id", ids).order("created_at", { ascending: false }),
      supabase.from("mood_group_members").select("group_id").in("group_id", ids),
    ]);
    if (gErr) throw gErr;
    if (amErr) throw amErr;

    const counts: Record<string, number> = {};
    for (const m of allMembers ?? []) counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;
    return NextResponse.json({
      ok: true,
      groups: (groups ?? []).map(g => ({ ...g, member_count: counts[g.id] ?? 0 })),
    });
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

    // ── 気分をつぶやく ──
    if (body.action === "post") {
      const groupId = String(body.groupId ?? "").trim();
      const mood    = String(body.mood ?? "").trim().slice(0, 20);
      const comment = String(body.comment ?? "").trim().slice(0, 200);
      if (!groupId || !mood) return NextResponse.json({ ok: false, error: "groupIdとmoodは必須です" }, { status: 400 });

      const { data: me, error: meErr } = await supabase
        .from("mood_group_members")
        .select("nickname")
        .eq("group_id", groupId).eq("device_id", deviceId)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) return NextResponse.json({ ok: false, error: "このグループのメンバーではありません" }, { status: 403 });

      const { data: post, error: pErr } = await supabase
        .from("mood_group_posts")
        .insert({ group_id: groupId, device_id: deviceId, nickname: me.nickname, mood, comment: comment || null })
        .select("id, device_id, nickname, mood, comment, created_at")
        .single();
      if (pErr) throw pErr;
      return NextResponse.json({ ok: true, post });
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
