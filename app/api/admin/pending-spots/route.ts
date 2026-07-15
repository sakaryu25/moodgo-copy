// ── /api/admin/pending-spots ──────────────────────────────────────────────────
// 統一投稿(spot_posts)で新スポットが投稿されると places に仮登録(source_type=user, is_active=false)される。
// これを admin が確認して承認(is_active=true=検索に出る)／却下(削除)する。
//   ★2026-07-06: 承認時にタグ/座標/住所/最寄駅を「調整」できるよう拡張。
//   合格時に決められた#(タグ)へ差し替えて検索反映する（要望3・解釈=タグ編集で検索先決定）。
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  if (sp.get("secret") !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: true, places: [] });
  try {
    // filter: pending(承認待ち=既定) / approved(承認済み) / rejected(却下履歴)
    //   承認済み=source_type:user & is_active:true、却下=source_type:user_rejected（ソフト却下＝履歴が残る）
    const filter = sp.get("filter") === "approved" ? "approved" : sp.get("filter") === "rejected" ? "rejected" : "pending";
    let q = supabase
      .from("places")
      .select("id, name, address, lat, lng, tags, nearest_station, description, created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (filter === "approved") q = q.eq("source_type", "user").eq("is_active", true);
    else if (filter === "rejected") q = q.eq("source_type", "user_rejected");
    else q = q.eq("source_type", "user").eq("is_active", false);
    const { data } = await q;
    const places = data ?? [];
    // 投稿本文(caption)を添付＝審査時に「利用者が何を書いたか」を見て調整できる
    const ids = places.map((p) => (p as { id: string }).id);
    const captionByPlace = new Map<string, string>();
    if (ids.length > 0) {
      const { data: posts } = await supabase
        .from("spot_posts")
        .select("place_id, caption, created_at")
        .in("place_id", ids)
        .order("created_at", { ascending: true });
      for (const p of (posts ?? []) as Array<{ place_id: string; caption?: string }>) {
        if (p.place_id && !captionByPlace.has(p.place_id) && p.caption) captionByPlace.set(p.place_id, p.caption);
      }
    }
    const withCaption = places.map((p) => ({ ...p, caption: captionByPlace.get((p as { id: string }).id) ?? null }));
    return NextResponse.json({ ok: true, places: withCaption });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const id = String(body?.id ?? "").trim();
  const action = String(body?.action ?? "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    if (action === "approve") {
      // 承認時に渡された編集値があれば places を更新（タグ/座標/住所/名前/最寄駅）。
      //   無ければ is_active=true だけ（従来動作）。合格＝検索に出る。source_typeをuserに戻す＝却下からの復帰も対応。
      const update: Record<string, unknown> = { is_active: true, source_type: "user" };
      if (Array.isArray(body?.tags)) {
        const tags = (body.tags as unknown[]).filter((t) => typeof t === "string" && t).slice(0, 30);
        // タグが1つも無いと検索に出ないので承認をブロック（決められた#に振り分けるのが承認の役割）
        if (tags.length === 0) return NextResponse.json({ ok: false, error: "タグを1つ以上付けてください（検索に出すため）" }, { status: 400 });
        update.tags = tags;
      }
      if (typeof body?.name === "string" && body.name.trim()) update.name = body.name.trim().slice(0, 120);
      if (typeof body?.address === "string" && body.address.trim()) update.address = body.address.trim().slice(0, 200);
      if (typeof body?.nearest_station === "string") update.nearest_station = body.nearest_station.trim().slice(0, 60) || null;
      const lat = Number(body?.lat), lng = Number(body?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
        update.lat = lat; update.lng = lng;
      }
      await supabase.from("places").update(update).eq("id", id);
    } else if (action === "reject") {
      // 却下 → ソフト却下（source_type=user_rejected・is_active=false）＝検索に出ないが履歴に残る＆復帰可。
      await supabase.from("places").update({ source_type: "user_rejected", is_active: false }).eq("id", id);
    } else if (action === "unreject") {
      // 却下履歴から「承認待ち」に戻す（source_type=user・is_active=false）
      await supabase.from("places").update({ source_type: "user", is_active: false }).eq("id", id);
    } else if (action === "purge") {
      // 却下履歴を完全削除（掃除用・元に戻せない）
      await supabase.from("places").delete().eq("id", id).eq("source_type", "user_rejected");
    } else {
      return NextResponse.json({ ok: false, error: "action(approve|reject|unreject|purge)が必要です" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
