export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 全国みんなの穴場フィード（公開）
 * GET /api/community-feed
 * 管理者承認済みのユーザー投稿スポットを新着順で返す。
 * 旧形式の画像URL（maps.googleapis.com/.../photo?photo_reference=AU_...）は
 * Expoから直接表示できないため、Google Places Text Searchで写真を再取得し
 * photo-proxy 経由URLに変換して返す。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, anonPosterId, iconPathFor } from "@/lib/device-hash";
import { toArea } from "@/lib/jp-area";
import { handlesByDevice, deviceByHandle, accountTypesByDevice, iconVersionsByDevice } from "@/lib/user-handles";

// ── キーワード検索の横断マッチ（2026-07-14）──────────────────────────────────
// 「東京カフェ」のような地名＋ジャンルの連結語でもヒットさせる:
//   ・NFKC＋小文字＋カタカナ→ひらがな折りたたみで表記ゆれを吸収
//   ・空白区切りは全トークンAND
//   ・空白なしの1語は、全体一致→ダメなら2分割(東京|カフェ)して両方一致で許容
//   対象は 名前/本文/タグ/住所 の連結haystack（SQLのilikeでは書けないためJS側で絞る）
const foldKw = (s: unknown) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
function makeKeywordMatcher(qRaw: string): (hay: string) => boolean {
  const tokens = foldKw(qRaw).split(/[\s　]+/).filter(Boolean);
  if (tokens.length === 0) return () => true;
  const tokenHit = (hay: string, tk: string): boolean => {
    if (hay.includes(tk)) return true;
    if (tk.length >= 3) {
      for (let i = 1; i < tk.length; i++) {
        if (hay.includes(tk.slice(0, i)) && hay.includes(tk.slice(i))) return true;
      }
    }
    return false;
  };
  return (hay) => tokens.every((tk) => tokenHit(hay, tk));
}

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

// 旧形式 Google Maps Photo URL か判定
function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 60);
  const offset = Number(searchParams.get("offset") ?? "0");
  // カーソルページング（created_at < cursor）。2ソース合流のoffset方式は
  // ページ境界で投稿が恒久欠落するバグがあるため、クライアントは2ページ目以降 cursor を送る。
  // offset は旧クライアント互換のため残す（cursor があれば cursor 優先）。
  const cursor = (searchParams.get("cursor") ?? "").trim() || null;
  // キーワード検索（スポット名/本文の部分一致）。PostgRESTのor構文に入るため記号は除去。
  const q = (searchParams.get("q") ?? "").trim().replace(/[,()*%]/g, "").slice(0, 50) || null;
  const kwMatch = q ? makeKeywordMatcher(q) : null;   // 横断キーワードマッチ（JS側）
  // @IDでのユーザー絞り込み（プロフィール検索）。匿名投稿の帰属バレ防止のため public のみ返す。
  const posterHandle = (searchParams.get("posterHandle") ?? "").trim().toLowerCase().replace(/^@+/, "");

  if (!supabase) {
    return NextResponse.json({ ok: false, items: [] }, { status: 503 });
  }

  try {
    // 投稿者アイコン: user-icons/{deviceHash}.jpg の公開URLを導出（写真未設定なら404→アプリ側でフォールバック）
    //   ⚠ device_id は「ベアラ資格情報」なので生値をURL/レスポンスに出さない（2026-07-05監査対応）。
    const vHour = Math.floor(Date.now() / 3_600_000);
    // ver 省略時は時間バケット(1h)にフォールバック。ver = user_handles.updated_at のepoch（名前/
    // アイコン変更でbumpされる）を渡すと、変更した時だけURLが変わり他人の画面でも即差し替わる。
    const iconFor = (deviceId: unknown, ver?: string): string | null => {
      if (typeof deviceId !== "string" || !deviceId) return null;
      const { data: pub } = supabase!.storage.from("user-icons").getPublicUrl(iconPathFor(deviceId));
      return `${pub.publicUrl}?v=${ver || vHour}`;
    };

    // ── みんなのMoodログ(spot_posts)も全国穴場フィードに合流 ────────────────────
    //   承認済み・公開(spot_public_anonymous/public)の投稿を同じカード形に整形して混ぜる。
    //   タップ時は場所詳細(/place)を開くため kind='moodlog'＋place_id を付ける。未作成でも安全。
    let moodItems: Array<Record<string, unknown>> = [];
    // ページング補助: 各ソースの生取得件数(hasMore判定)と最古created_at(全滅フィルタ時のカーソル前進用)
    let rawMoodCount = 0;
    let rawSugCount = 0;
    let oldestFetched: string | null = null;
    const trackOldest = (list: Array<Record<string, unknown>>) => {
      const tail = list[list.length - 1]?.created_at;
      if (tail && (!oldestFetched || String(tail) < oldestFetched)) oldestFetched = String(tail);
    };
    // ユーザー絞り込み時: handle→device_id をサーバー内で解決（生IDは外に出さない）
    //   ※並列ブロックの外で解決（ブロック内からGETの応答を返せないため）
    let posterDeviceId: string | null = null;
    if (posterHandle) {
      posterDeviceId = await deviceByHandle(supabase, posterHandle);
      if (!posterDeviceId) return NextResponse.json({ ok: true, items: [] });  // 存在しないID
    }

    // ── Moodログ取得（穴場suggestionsと並列実行・コールドDBでの直列待ちを解消）──
    const moodPromise = (async () => { try {
      // price_chip/rating は spot-posts-extra.sql 未適用だと列が無い → まずフル、42703なら基本列で再試行
      const BASE_COLS = "id, device_id, poster_name, place_id, place_name, caption, mood_tags, created_at, visibility, like_count, helpful_count";
      const buildQ = (cols: string) => {
        let qq = supabase!.from("spot_posts").select(cols).eq("status", "approved");
        qq = posterDeviceId
          ? qq.eq("device_id", posterDeviceId).eq("visibility", "public")
          : qq.in("visibility", ["spot_public_anonymous", "public"]);
        if (cursor) qq = qq.lt("created_at", cursor);
        const ordered = qq.order("created_at", { ascending: false });
        // 検索時は広めに取得してJS横断マッチ（名前/本文/タグ/住所）で絞る。
        //   ⚠後段の写真join(in句)のURL長制限があるためプールは200件（現状の投稿規模では実質全件）
        if (q) return ordered.limit(200);
        return cursor ? ordered.limit(limit) : ordered.range(offset, offset + limit - 1);
      };
      let { data: posts, error: postsErr } = await buildQ(`${BASE_COLS}, price_chip, rating`);
      if (postsErr && (postsErr as { code?: string }).code === "42703") {
        ({ data: posts } = await buildQ(BASE_COLS));
      }
      const plist = (posts ?? []) as unknown as Array<Record<string, unknown>>;
      rawMoodCount = plist.length;
      trackOldest(plist);
      if (plist.length > 0) {
        const postIds = plist.map(p => String(p.id));
        const placeIds = [...new Set(plist.map(p => p.place_id).filter(Boolean).map(String))];
        const names2 = [...new Set(plist.map(p => p.place_name).filter(Boolean).map(String))];
        // 都道府県(places.address) を id と name の両方で引けるようにする（place_idがgoogle_id/nullでも名前で補完）
        const toPref = toArea;   // カード地名を「都道府県＋市区町村」に（[[jp-area]]）
        // 写真・places(id/name)・@ハンドルの4系統を並列取得（従来は直列で最も遅い区間だった）
        const nonAnonDevs = plist.filter(p => p.visibility !== "spot_public_anonymous").map(p => String(p.device_id ?? ""));
        const [phsRes, plsIdRes, plsNameRes, handleMap, acctMap, verMap] = await Promise.all([
          supabase.from("spot_photos").select("post_id, image_url")
            .in("post_id", postIds).neq("moderation_status", "hidden").neq("moderation_status", "rejected"),
          placeIds.length > 0
            ? supabase.from("places").select("id, address, lat, lng").in("id", placeIds)
            : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
          names2.length > 0
            ? supabase.from("places").select("name, address, lat, lng").in("name", names2).eq("is_active", true)
            : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
          handlesByDevice(supabase, nonAnonDevs),
          accountTypesByDevice(supabase, nonAnonDevs),
          iconVersionsByDevice(supabase, nonAnonDevs),
        ]);
        const photoByPost = new Map<string, string[]>();
        for (const ph of (phsRes.data ?? []) as Array<Record<string, unknown>>) {
          const k = String(ph.post_id); if (!photoByPost.has(k)) photoByPost.set(k, []);
          if (!isLegacyPhotoUrl(String(ph.image_url))) photoByPost.get(k)!.push(String(ph.image_url));
        }
        const prefByPlace = new Map<string, string>();
        const prefByName = new Map<string, string>();
        const rawAddrByPlace = new Map<string, string>();   // 検索haystack用（東京都◯◯…のフル住所）
        const rawAddrByName = new Map<string, string>();
        const coordByPlace = new Map<string, { lat: number; lng: number }>();
        const coordByName = new Map<string, { lat: number; lng: number }>();
        for (const pl of (plsIdRes.data ?? []) as Array<Record<string, unknown>>) {
          prefByPlace.set(String(pl.id), toPref(pl.address));
          rawAddrByPlace.set(String(pl.id), String(pl.address ?? ""));
          if (pl.lat != null && pl.lng != null) coordByPlace.set(String(pl.id), { lat: Number(pl.lat), lng: Number(pl.lng) });
        }
        for (const pl of (plsNameRes.data ?? []) as Array<Record<string, unknown>>) {
          prefByName.set(String(pl.name), toPref(pl.address));
          rawAddrByName.set(String(pl.name), String(pl.address ?? ""));
          if (pl.lat != null && pl.lng != null) coordByName.set(String(pl.name), { lat: Number(pl.lat), lng: Number(pl.lng) });
        }
        // キーワード横断マッチ: 名前/本文/気分タグ/住所のどこかに全トークンが一致（連結語は2分割許容）
        const searched = kwMatch
          ? plist.filter(p => kwMatch(foldKw([
              p.place_name, p.caption,
              Array.isArray(p.mood_tags) ? (p.mood_tags as unknown[]).join(" ") : "",
              rawAddrByPlace.get(String(p.place_id)) || rawAddrByName.get(String(p.place_name)) || "",
            ].join(" ")))).slice(0, limit)
          : plist;
        moodItems = searched.map(p => {
          const anon = p.visibility === "spot_public_anonymous";
          return {
            id: `ml-${p.id}`, kind: "moodlog",
            place_id: p.place_id ?? null, place_name: String(p.place_name ?? ""),
            spot_name: String(p.place_name ?? ""),
            prefecture: prefByPlace.get(String(p.place_id)) || prefByName.get(String(p.place_name)) || "",
            description: p.caption ?? "", address: null,
            image_urls: photoByPost.get(String(p.id)) ?? [],
            auto_tags: p.mood_tags ?? [],
            lat: (coordByPlace.get(String(p.place_id)) || coordByName.get(String(p.place_name)))?.lat ?? null,
            lng: (coordByPlace.get(String(p.place_id)) || coordByName.get(String(p.place_name)))?.lng ?? null,
            likes: (Number(p.like_count) || 0) + (Number(p.helpful_count) || 0),
            price_chip: (p.price_chip as string | null) ?? null,   // 目安価格（カード表示用・独立カラム）
            rating: typeof p.rating === "number" ? p.rating : null, // おすすめ度（★・独立カラム）
            created_at: p.created_at,
            poster_name: anon ? null : ((p.poster_name as string | null) ?? null),
            poster_handle: anon ? null : (handleMap.get(String(p.device_id ?? "")) ?? null),
            poster_type: anon ? null : (acctMap.get(String(p.device_id ?? "")) ?? null),
            poster_icon: anon ? null : iconFor(p.device_id, verMap.get(String(p.device_id ?? ""))),
            // ブロック用の公開識別子。生device_id(=これを知られると本人として全操作可能)は返さずハッシュ。
            //   匿名投稿は deviceHash とは別名前空間の anonPosterId を使う（公開投稿/プロフィールへの
            //   逆引きを遮断・ブロックは不透明ハッシュ一致なので維持）。
            poster_id: typeof p.device_id === "string" && p.device_id
              ? (anon ? anonPosterId(p.device_id) : deviceHash(p.device_id))
              : null,
            poster_anonymous: anon,   // 名前非公開の投稿か（本人でも名前を出さない＝設定を反映）
          };
        });
      }
    } catch { /* spot_posts未作成は穴場のみ表示 */ } })();

    // ── 穴場投稿(suggestions・承認済み)も合流（2026-07-07復元・Moodログと並列実行）──
    //   「全国みんなの穴場」の母集団は穴場投稿。moodログ(spot_posts)と同じカード形に整形して混ぜる。
    //   ユーザー絞り込み(@ID)時は spot_posts のみ対象なので suggestions は足さない。
    let suggestionItems: Array<Record<string, unknown>> = [];
    const sugPromise = (async () => {
      if (posterHandle) return;
      try {
        const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);   // JST基準（期間限定の当日判定）
        const toPref = toArea;   // カード地名を「都道府県＋市区町村」に（[[jp-area]]）
        let sq = supabase
          .from("suggestions")
          .select("id, spot_name, google_place_name, description, address, image_urls, auto_tags, lat, lng, created_at, poster_name, device_id, available_from, available_until")
          .eq("status", "approved");
        if (cursor) sq = sq.lt("created_at", cursor);
        const sOrdered = sq.order("created_at", { ascending: false });
        // 検索時は広めに取得してJS横断マッチ（名前/本文/タグ/住所）で絞る
        const { data: sugs } = await (q ? sOrdered.limit(200) : cursor ? sOrdered.limit(limit) : sOrdered.range(offset, offset + limit - 1));
        const slist = (sugs ?? []) as unknown as Array<Record<string, unknown>>;
        rawSugCount = slist.length;
        trackOldest(slist);
        // 公開期間外(期間限定)は除外（null=常時公開）
        const inPeriod = (s: Record<string, unknown>) => {
          const f = s.available_from as string | null, u = s.available_until as string | null;
          return (!f || f <= today) && (!u || u >= today);
        };
        // 開発時のシード穴場（写真も投稿者も無い空カード）はフィードに出さない（2026-07-15ユーザー依頼）。
        //   利用者の投稿は写真必須＋device_id記録があるため必ず残る。写真ありは投稿者不明でも残す。
        const notSeed = (s: Record<string, unknown>) => {
          const imgs = s.image_urls as unknown[] | null;
          const hasImg = Array.isArray(imgs) && imgs.length > 0;
          const hasDev = !!(s.device_id as string | null | undefined)?.trim?.();
          return hasImg || hasDev;
        };
        // キーワード横断マッチ: 名前(投稿名/Google名)/本文/タグ/住所に全トークン一致（連結語は2分割許容）
        const sMatched = kwMatch
          ? slist.filter(s => kwMatch(foldKw([
              s.spot_name, s.google_place_name, s.description,
              Array.isArray(s.auto_tags) ? (s.auto_tags as unknown[]).join(" ") : "",
              s.address,
            ].join(" ")))).slice(0, limit)
          : slist;
        const sDevs = sMatched.map(s => String(s.device_id ?? ""));
        const sHandleMap = await handlesByDevice(supabase, sDevs);
        const sAcctMap = await accountTypesByDevice(supabase, sDevs);
        const sVerMap = await iconVersionsByDevice(supabase, sDevs);
        suggestionItems = sMatched.filter(inPeriod).filter(notSeed).map(s => {
          const rawImgs = (s.image_urls ?? []) as string[];
          const imgs = Array.isArray(rawImgs) ? rawImgs.filter(u => typeof u === "string" && !isLegacyPhotoUrl(u)) : [];
          const dev = typeof s.device_id === "string" ? s.device_id : "";
          return {
            id: String(s.id), kind: "suggestion",
            place_id: null, place_name: String(s.google_place_name ?? s.spot_name ?? ""),
            spot_name: String(s.spot_name ?? s.google_place_name ?? ""),
            prefecture: toPref(s.address),
            description: (s.description as string | null) ?? "", address: (s.address as string | null) ?? null,
            image_urls: imgs,
            auto_tags: (s.auto_tags as string[] | null) ?? [],
            lat: typeof s.lat === "number" ? s.lat : null,
            lng: typeof s.lng === "number" ? s.lng : null,
            likes: undefined,
            price_chip: null, rating: null,
            created_at: s.created_at,
            poster_name: (s.poster_name as string | null) ?? null,
            poster_handle: dev ? (sHandleMap.get(dev) ?? null) : null,
            poster_type: dev ? (sAcctMap.get(dev) ?? null) : null,
            poster_icon: dev ? iconFor(dev, sVerMap.get(dev)) : null,
            poster_id: dev ? deviceHash(dev) : null,
          };
        });
      } catch { /* suggestions取得失敗はmoodログのみで続行 */ }
    })();

    // 2ソースを同時に取得（従来は直列＝コールド/低速DBで所要が倍増していた）
    await Promise.all([moodPromise, sugPromise]);

    // moodログ＋穴場投稿を新着順で合流して返す（idで重複排除）。
    const seen = new Set<string>();
    const merged = [...moodItems, ...suggestionItems]
      .filter(it => { const k = String(it.id); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .slice(0, limit);

    // 次ページ用カーソル: 返した最後の created_at。sliceで溢れた分はそれより古いので
    // 次ページ(created_at < nextCursor)で必ず再取得される=欠落しない。
    // 全件が期間フィルタ等で落ちた場合は生取得の最古まで前進させ、無限に同じ窓を読まない。
    const lastItem = merged[merged.length - 1];
    const nextCursor = (lastItem?.created_at ? String(lastItem.created_at) : null) ?? oldestFetched;
    // どちらかのソースがlimit件まるごと返した=まだ先がある可能性が高い
    // 検索(q)時は広めプールを一発取得しJS側で絞る方式＝続きページは無い（hasMore=trueだと将来の無限スクロールが空フェッチし続ける）
    const hasMore = q ? false : (rawMoodCount >= limit || rawSugCount >= limit);

    // エッジキャッシュ: 60秒は同一URLをCDNから即返す（コールドDBの遅さを利用者から隠す）。
    // ホームと一覧が同じ先頭ページを叩くためヒット率が高い。いいね数等の鮮度は60秒で十分。
    return NextResponse.json(
      { ok: true, items: merged, nextCursor, hasMore },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (e) {
    console.error("[community-feed]", e);
    return NextResponse.json({ ok: false, items: [], error: String(e) });
  }
}
