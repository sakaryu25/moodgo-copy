// ─── /api/user-handle ────────────────────────────────────────────────────────
// ユーザーID（@ハンドル）の 取得 / 空きチェック / 取得(claim)・変更。
//   一意性は user_handles.handle 主キー（DB）で保証＝同じIDは他人が絶対に取れない。
//   形式: 半角英数と _ のみ・3〜20文字・小文字統一。予約語とNGワードは拒否。
//   deviceId はベアラ資格情報のため POST body のみ（クエリ不可）・レスポンスに生値を返さない。
//   POST {action:'get',   deviceId}          → {ok, handle|null}
//   POST {action:'check', handle}            → {ok, available, reason?}   ※誰でも可（漏洩情報なし）
//   POST {action:'claim', deviceId, handle}  → {ok} | {ok:false, error, taken?}
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findNgWord } from "@/lib/ngwords";
import { deviceHash, iconPathFor } from "@/lib/device-hash";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
// なりすまし/紛らわしいIDを防ぐ予約語
const RESERVED = new Set([
  "moodgo", "admin", "administrator", "official", "support", "system",
  "moderator", "mod", "staff", "help", "info", "root", "null", "undefined", "anonymous",
]);

function normalize(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/^@+/, "");
}
function validate(handle: string): string | null {
  if (!HANDLE_RE.test(handle)) return "IDは半角英数と_のみ・3〜20文字です";
  if (RESERVED.has(handle)) return "このIDは使用できません";
  if (findNgWord(handle)) return "このIDは使用できません";
  return null;
}
function isMissingTable(e: { code?: string; message?: string } | null): boolean {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist/i.test(e.message ?? ""));
}
const TABLE_MISSING_MSG = "ID機能の準備中です（supabase/user-handles.sql 未適用）";

// locked_until 列が未適用（マイグレーション前）かの判定。PostgREST=PGRST204 / 生PG=42703 / メッセージ照合。
function isMissingColumn(e: { code?: string; message?: string } | null): boolean {
  return !!e && ((e.code === "PGRST204" || e.code === "42703") || /locked_until|column/i.test(e.message ?? ""));
}

// ID変更のクールダウン（変更後この日数は再変更不可）
const LOCK_DAYS = 14;
// locked_until から「まだロック中か・残り日数・ロック期限」を導出（列が無ければ非ロック扱い）
function lockInfo(lockedUntil: unknown): { locked: boolean; until: string | null; daysLeft: number } {
  if (typeof lockedUntil !== "string" || !lockedUntil) return { locked: false, until: null, daysLeft: 0 };
  const t = Date.parse(lockedUntil);
  if (!Number.isFinite(t) || t <= Date.now()) return { locked: false, until: null, daysLeft: 0 };
  return { locked: true, until: lockedUntil, daysLeft: Math.ceil((t - Date.now()) / 86_400_000) };
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  if (!rateLimit(`user-handle:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "");

  try {
    // ── @ID の前方一致検索（メンション補完用・公開情報のみ）──
    if (action === "search") {
      const q = String(body?.q ?? body?.handle ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
      if (q.length < 1) return NextResponse.json({ ok: true, handles: [] });
      const { data } = await db.from("user_handles").select("handle").ilike("handle", `${q}%`).limit(8);
      const handles = ((data ?? []) as Array<{ handle?: string }>).map((r) => String(r.handle ?? "")).filter(Boolean);
      return NextResponse.json({ ok: true, handles });
    }

    // ── 自分のIDを取得（ロック状態も返す）─────────────────────────────────────
    if (action === "get") {
      const deviceId = String(body?.deviceId ?? "").trim();
      if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId必須" }, { status: 400 });
      // locked_until 列が無い環境でも動くよう "*" で取得
      const { data, error } = await db.from("user_handles").select("*").eq("device_id", deviceId).maybeSingle();
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: true, handle: null, tableMissing: true });
        throw error;
      }
      const lock = lockInfo(data?.locked_until);
      return NextResponse.json({
        ok: true,
        handle: (data?.handle as string | undefined) ?? null,
        bio: (data?.bio as string | undefined) ?? null,
        accountType: (data?.account_type as string | undefined) ?? null,   // 'official'|'store'|'user'|null（バッジ用）
        lockedUntil: lock.until,   // ISO or null
        daysLeft: lock.daysLeft,   // ロック中の残り日数（切り上げ）・非ロックは0
      });
    }

    // ── 一言メッセージ(bio)を保存（IDを持つ人の user_handles 行に格納）──────────
    //   bio列/テーブル未適用でも安全にok(saved:false)を返す。プロフィール表示で公開される。
    if (action === "set-bio") {
      const deviceId = String(body?.deviceId ?? "").trim();
      if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId必須" }, { status: 400 });
      const bio = String(body?.bio ?? "").trim().slice(0, 80);
      const { data, error } = await db.from("user_handles").update({ bio }).eq("device_id", deviceId).select("device_id");
      if (error) {
        if (isMissingTable(error) || (error as { code?: string }).code === "42703") return NextResponse.json({ ok: true, saved: false, tableMissing: true });
        throw error;
      }
      // 行が無い（ID未設定）＝bioの置き場所が無い。localには残るのでok扱い。
      return NextResponse.json({ ok: true, saved: Array.isArray(data) && data.length > 0 });
    }

    // ── 空きチェック（入力中のリアルタイム判定用）───────────────────────────
    if (action === "check") {
      const handle = normalize(body?.handle);
      const bad = validate(handle);
      if (bad) return NextResponse.json({ ok: true, available: false, reason: bad });
      const { data, error } = await db.from("user_handles").select("device_id").eq("handle", handle).maybeSingle();
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true, error: TABLE_MISSING_MSG });
        throw error;
      }
      // 自分が既に持っているIDなら「利用可能(=そのまま)」扱い
      const deviceId = String(body?.deviceId ?? "").trim();
      const mine = !!deviceId && data?.device_id === deviceId;
      return NextResponse.json({ ok: true, available: !data || mine, reason: data && !mine ? "このIDはすでに使われています" : undefined });
    }

    // ── ユーザー検索（@ID前方一致・最大10件）─────────────────────────────────
    //   返すのは handle / posterId(=deviceHash・ブロック用公開ID) / ハッシュ名アイコンURL のみ。
    //   生device_idは絶対に返さない（資格情報）。
    if (action === "search") {
      const qn = normalize(body?.query);
      if (!/^[a-z0-9_]{2,20}$/.test(qn)) return NextResponse.json({ ok: true, users: [] });
      const { data, error } = await db.from("user_handles")
        .select("handle, device_id").ilike("handle", `${qn}%`).order("handle").limit(10);
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: true, users: [], tableMissing: true });
        throw error;
      }
      const vHour = Math.floor(Date.now() / 3_600_000);
      const users = (data ?? []).map((r) => {
        const dev = (r as { device_id: string }).device_id;
        const { data: pub } = db.storage.from("user-icons").getPublicUrl(iconPathFor(dev));
        return { handle: (r as { handle: string }).handle, posterId: deviceHash(dev), icon: `${pub.publicUrl}?v=${vHour}` };
      });
      return NextResponse.json({ ok: true, users });
    }

    // ── 取得/変更（一意性はDBのunique制約が最終保証・レースも23505で弾く）────
    if (action === "claim") {
      const deviceId = String(body?.deviceId ?? "").trim();
      const handle = normalize(body?.handle);
      if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId必須" }, { status: 400 });
      const bad = validate(handle);
      if (bad) return NextResponse.json({ ok: false, error: bad });

      // 既存の自分の行（locked_until 列が無くても "*" なら安全に取れる）
      const { data: own, error: ownErr } = await db.from("user_handles").select("*").eq("device_id", deviceId).maybeSingle();
      if (ownErr) {
        if (isMissingTable(ownErr)) return NextResponse.json({ ok: false, tableMissing: true, error: TABLE_MISSING_MSG });
        throw ownErr;
      }
      if (own?.handle === handle) return NextResponse.json({ ok: true, handle });  // 変更なし

      if (own) {
        // ── 2週間ロック: 前回の変更から14日以内は再変更を拒否 ──
        const lock = lockInfo(own.locked_until);
        if (lock.locked) {
          return NextResponse.json({
            ok: false, locked: true, lockedUntil: lock.until, daysLeft: lock.daysLeft,
            error: `IDは変更後14日間は再変更できません（あと${lock.daysLeft}日）`,
          });
        }
        // 変更: handle更新＋次の変更可能時刻を14日後にセット（他人が同handle保持ならPK違反23505で失敗＝奪えない）
        const nextLock = new Date(Date.now() + LOCK_DAYS * 86_400_000).toISOString();
        const now = new Date().toISOString();
        let { error } = await db.from("user_handles")
          .update({ handle, updated_at: now, locked_until: nextLock })
          .eq("device_id", deviceId);
        // locked_until 列が未適用の環境: その列を外して再試行（ロックは効かないが変更は成功）。
        //   PostgRESTは未知列の更新に PGRST204、生Postgresは 42703 を返す（両方＋メッセージで判定）。
        if (error && isMissingColumn(error)) {
          ({ error } = await db.from("user_handles").update({ handle, updated_at: now }).eq("device_id", deviceId));
        }
        if (error) {
          if ((error as { code?: string }).code === "23505") {
            return NextResponse.json({ ok: false, taken: true, error: "このIDはすでに使われています" });
          }
          throw error;
        }
        // 変更成功: 次に変更できるのは14日後
        return NextResponse.json({ ok: true, handle, lockedUntil: nextLock, daysLeft: LOCK_DAYS });
      } else {
        // 新規（初回設定はロック対象外＝すぐ直せる）: insert（同handle同時取得はPKが片方を23505で弾く）
        const { error } = await db.from("user_handles").insert({ handle, device_id: deviceId });
        if (error) {
          if ((error as { code?: string }).code === "23505") {
            return NextResponse.json({ ok: false, taken: true, error: "このIDはすでに使われています" });
          }
          throw error;
        }
        return NextResponse.json({ ok: true, handle });
      }
    }

    return NextResponse.json({ ok: false, error: "不正なaction" }, { status: 400 });
  } catch (e) {
    console.error("[user-handle]", e);
    // PostgRESTのエラーは {code,message,...} オブジェクト＝String()だと "[object Object]" になるので message を優先
    const msg = e instanceof Error ? e.message
      : (e && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message)
      : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
