export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 全国みんなの穴場 — スポット詳細（公開）
 * GET /api/community-spot?id=UUID            … suggestions(穴場)
 * GET /api/community-spot?id=ml-<spot_post>  … spot_posts(みんなのMoodログ＝統一投稿)
 *
 * 同じ Spot 形（写真カルーセル＋「どんな場所？」＋投稿者おすすめ度＋Google補強）で返す。
 *  - 写真は利用者投稿を優先（無ければ Google から補強）
 *  - 電話・公式サイト・営業時間・最寄駅・評価・口コミは Google Places から取得
 *  - 穴場は説明文から「目安価格」「おすすめ度★」をパースして分離（moodログは素のcaption）
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, iconPathFor } from "@/lib/device-hash";
import { handlesByDevice, iconVersionsByDevice, accountTypesByDevice } from "@/lib/user-handles";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}
function buildProxyUrl(origin: string, photoName: string): string {
  const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media`;
  return `${origin}/api/photo-proxy?url=${encodeURIComponent(mediaUrl)}`;
}
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 説明文から 価格・おすすめ度 を分離（穴場の旧記法）
function parseDescription(raw: string | null): { desc: string; priceText: string; rating: number } {
  if (!raw) return { desc: "", priceText: "", rating: 0 };
  let priceText = "";
  let rating = 0;
  const lines = raw.split("\n").filter((l) => {
    const priceM = l.match(/^【目安価格】\s*(.+)$/);
    if (priceM) { priceText = priceM[1].trim(); return false; }
    const rateM = l.match(/^【おすすめ度】\s*★(\d)/);
    if (rateM) { rating = Number(rateM[1]); return false; }
    return true;
  });
  return { desc: lines.join("\n").trim(), priceText, rating };
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const idParam = searchParams.get("id");
  const viewerHash = (searchParams.get("viewerHash") ?? "").trim().slice(0, 32);   // 閲覧者の公開ハッシュ=本人判定用（生device_idではない）
  if (!idParam) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  let isMoodlog = idParam.startsWith("ml-");
  const realId = isMoodlog ? idParam.slice(3) : idParam;

  try {
    // 救済: 過去のお気に入りは spot_post を "ml-" 無しの生UUIDで保存していた（クライアント修正済み）。
    //   生UUIDが spot_posts に存在すれば moodlog として扱い、suggestions誤引きの「見つかりません」を防ぐ。
    if (!isMoodlog && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(realId)) {
      const { data: probe } = await supabase.from("spot_posts").select("id").eq("id", realId).maybeSingle();
      if (probe) isMoodlog = true;
    }
    // ── 基本フィールド（穴場 / Moodログ で出所が違うが、以降は共通処理）──
    let respId = realId;
    let userTitle = "";
    let placeName = "";
    let descBody = "";
    let priceText = "";
    let rating = 0;
    let baseAddress = "";
    let baseLat: number | undefined;
    let baseLng: number | undefined;
    let userPhotos: string[] = [];
    let createdAt: string | null = null;
    let autoTags: unknown = [];
    let stationSeed = "";
    let hoursSeed = "";
    let googleMapsUriSeed = "";
    let availableFrom: string | null = null;
    let availableUntil: string | null = null;
    // 投稿者（@ID表示用）。匿名投稿(spot_public_anonymous)では一切出さない。
    let posterName: string | null = null;
    let posterHandle: string | null = null;
    let posterIcon: string | null = null;
    let posterId: string | null = null;   // 公開ハッシュ（プロフィール/フォロー用・生device_idは返さない）
    let posterType: string | null = null; // 投稿者バッジ種別（official/store・未設定はnull）
    let isMine = false;                    // 閲覧者が投稿者本人か（匿名でも本人には自分の表示を出す）
    let postVisibility = "";               // 投稿の公開範囲（本人向けに「匿名で公開中」等の表示に使う）

    if (isMoodlog) {
      // ── みんなのMoodログ(spot_posts)＝「投稿」ボタンから入る統一投稿 ──
      // price_chip等の新カラム(spot-posts-extra.sql)が未適用でも壊れないよう フル列→基本列 でフォールバック
      let pRow = (await supabase
        .from("spot_posts")
        .select("id, place_id, place_name, caption, mood_tags, created_at, poster_name, device_id, visibility, price_chip, price_note, rating")
        .eq("id", realId)
        .single()).data as Record<string, unknown> | null;
      if (!pRow) {
        const { data: p2, error: e2 } = await supabase
          .from("spot_posts")
          .select("id, place_id, place_name, caption, mood_tags, created_at, poster_name, device_id, visibility")
          .eq("id", realId)
          .single();
        // 行が無い(削除済み/存在しないID)は404＝クライアントは「見つかりません」表示（旧: 500+[object Object]）
        if (e2 || !p2) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
        pRow = p2 as Record<string, unknown>;
      }
      const post = pRow;
      // 価格/おすすめ度は独立カラム（captionへの埋め込みは廃止済み・旧投稿の埋め込みはcaptionのまま表示）
      if (typeof post.price_note === "string" && post.price_note) priceText = post.price_note;
      else if (typeof post.price_chip === "string" && post.price_chip) priceText = post.price_chip;
      if (typeof post.rating === "number" && post.rating >= 1 && post.rating <= 5) rating = post.rating;
      postVisibility = String(post.visibility ?? "");
      const mlDevId = typeof post.device_id === "string" ? post.device_id : "";
      isMine = !!viewerHash && !!mlDevId && deviceHash(mlDevId) === viewerHash;
      // ── 非公開ガード（不変条件: private/group は投稿者本人以外に一切返さない）──────────
      //   community-spot は id 直引きのため、ここで弾かないと非公開投稿の本文/写真/場所/投稿者
      //   情報（実名/@ID/アイコン/deviceHash）が誰にでも漏れる。本人(isMine)以外には「存在しない」
      //   扱い(404)で返す。公開(public)・匿名公開(spot_public_anonymous)だけが他人に見られる。
      if (postVisibility !== "public" && postVisibility !== "spot_public_anonymous" && !isMine) {
        return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      }
      if (mlDevId) {
        // 匿名投稿は他者には出さないが、本人(isMine)には自分のプロフィール表示を出す
        if (post.visibility !== "spot_public_anonymous" || isMine) {
          posterName = (post.poster_name as string | null) ?? null;
          posterHandle = (await handlesByDevice(supabase, [mlDevId])).get(mlDevId) ?? null;
          const iconVer = (await iconVersionsByDevice(supabase, [mlDevId])).get(mlDevId);
          const { data: pub } = supabase.storage.from("user-icons").getPublicUrl(iconPathFor(mlDevId));
          posterIcon = `${pub.publicUrl}?v=${iconVer || Math.floor(Date.now() / 3_600_000)}`;
          posterId = deviceHash(mlDevId);
          posterType = (await accountTypesByDevice(supabase, [mlDevId])).get(mlDevId) ?? null;
        }
      }
      respId = String(post.id);
      userTitle = String(post.place_name ?? "").trim();
      placeName = userTitle;
      descBody = String(post.caption ?? "");   // moodログは素のcaption（価格/★記法なし）
      createdAt = (post.created_at as string | null) ?? null;
      autoTags = post.mood_tags ?? [];

      // 投稿写真（旧形式は除外・非表示/却下は除く）
      const { data: phs } = await supabase
        .from("spot_photos")
        .select("image_url")
        .eq("post_id", realId)
        .neq("moderation_status", "hidden")
        .neq("moderation_status", "rejected");
      userPhotos = ((phs ?? []) as Array<{ image_url?: string }>)
        .map((x) => String(x.image_url ?? ""))
        .filter((u) => u && !isLegacyPhotoUrl(u));

      // 紐づくplace: Supabase UUID の時だけ住所/座標を引く（選択スポット・新スポット仮登録）。
      // Google id(ChIJ..)/null は住所が取れないので、後段のGoogle補強は名前検索に委ねる。
      const pid = post.place_id ? String(post.place_id) : "";
      if (UUID_RE.test(pid)) {
        // 選択スポット/新スポット仮登録の詳細を読む。available_from/until 列が未作成でも
        //   壊れないよう「フル列→安全列」にフォールバックする。
        let pl = (await supabase.from("places")
          .select("address, lat, lng, open_hours, nearest_station, available_from, available_until")
          .eq("id", pid).single()).data as Record<string, unknown> | null;
        if (!pl) {
          pl = (await supabase.from("places")
            .select("address, lat, lng, open_hours, nearest_station")
            .eq("id", pid).single()).data as Record<string, unknown> | null;
        }
        if (pl) {
          baseAddress = String(pl.address ?? "");
          if (pl.lat != null) baseLat = Number(pl.lat);
          if (pl.lng != null) baseLng = Number(pl.lng);
          if (pl.nearest_station) stationSeed = String(pl.nearest_station);   // 友達が入力した最寄駅
          if (pl.open_hours) hoursSeed = String(pl.open_hours);               // 友達が入力した営業時間
          if (pl.available_from) availableFrom = String(pl.available_from);   // 期間限定(列があれば)
          if (pl.available_until) availableUntil = String(pl.available_until);
        }
      }
    } else {
      // ── 全国みんなの穴場(suggestions)──
      const { data: s, error } = await supabase
        .from("suggestions")
        .select("id, spot_name, google_place_name, description, address, image_urls, auto_tags, lat, lng, contact, station_info, google_maps_uri, created_at, available_from, available_until, poster_name, device_id")
        .eq("id", realId)
        .single();
      // 行が無い(削除済み/存在しないID)は404（旧: 500+[object Object]）
      if (error || !s) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      if (typeof (s as Record<string, unknown>).device_id === "string" && (s as Record<string, unknown>).device_id) {
        const dev = String((s as Record<string, unknown>).device_id);
        posterName = ((s as Record<string, unknown>).poster_name as string | null) ?? null;
        posterHandle = (await handlesByDevice(supabase, [dev])).get(dev) ?? null;
        const iconVer = (await iconVersionsByDevice(supabase, [dev])).get(dev);
        const { data: pub } = supabase.storage.from("user-icons").getPublicUrl(iconPathFor(dev));
        posterIcon = `${pub.publicUrl}?v=${iconVer || Math.floor(Date.now() / 3_600_000)}`;
        posterId = deviceHash(dev);
        posterType = (await accountTypesByDevice(supabase, [dev])).get(dev) ?? null;
      }
      respId = String(s.id);
      userTitle = (s.spot_name ?? "").trim();
      placeName = (s.google_place_name ?? s.spot_name ?? "").trim();
      const parsed = parseDescription(s.description);
      descBody = parsed.desc;
      priceText = parsed.priceText;
      rating = parsed.rating;
      baseAddress = s.address ?? "";
      baseLat = typeof s.lat === "number" ? s.lat : undefined;
      baseLng = typeof s.lng === "number" ? s.lng : undefined;
      const rawImgs = (s.image_urls ?? []).filter(Boolean) as string[];
      userPhotos = rawImgs.filter((u) => !isLegacyPhotoUrl(u));
      createdAt = s.created_at ?? null;
      autoTags = s.auto_tags ?? [];
      stationSeed = (s.station_info ?? "").trim();
      googleMapsUriSeed = s.google_maps_uri ?? "";
      availableFrom = s.available_from ?? null;
      availableUntil = s.available_until ?? null;
    }

    // 都道府県
    const cleanAddr0 = baseAddress.replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "").trim();
    const prefMatch = cleanAddr0.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
    const prefecture = prefMatch ? prefMatch[1].replace(/[都道府県]$/, "") : "";

    const description = descBody;
    const hasUserPhotos = userPhotos.length > 0;

    // ── Google Places で補強（穴場・Moodログ共通）───────────────────────────
    let phone = "", website = "", openingHoursText = hoursSeed, googleMapsUri = googleMapsUriSeed;
    let address = baseAddress;
    let placeId: string | undefined;
    let placeLat = baseLat;
    let placeLng = baseLng;
    let googlePhotos: string[] = [];
    let googleRating: number | null = null;
    let reviewCount: number | null = null;
    let openNow: boolean | null = null;
    let reviews: Array<{ rating: number | null; text: string; authorName: string; authorPhoto: string | null; relativeTime: string }> = [];

    // 住所がある時のみ Google で位置特定して補強（写真・電話等）。
    // 住所が無ければ名前だけの曖昧検索で別の似た店を拾うのを防ぐため補強しない。
    if (GOOGLE_API_KEY && placeName && cleanAddr0) {
      try {
        const q = `${cleanAddr0} ${placeName}`;
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.formattedAddress,places.location,places.photos,places.googleMapsUri,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.currentOpeningHours,places.rating,places.userRatingCount,places.reviews",
          },
          body: JSON.stringify({
            textQuery: q, languageCode: "ja", regionCode: "JP", maxResultCount: 1,
            // 投稿に座標があれば近傍を優先（名前だけ一致の遠方店を拾わないように）
            ...(typeof baseLat === "number" && typeof baseLng === "number"
              ? { locationBias: { circle: { center: { latitude: baseLat, longitude: baseLng }, radius: 1000 } } }
              : {}),
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(7000),
        });
        if (res.ok) {
          const d = await res.json().catch(() => null);
          let p = d?.places?.[0];
          // ── 住所（座標）ベースの一致検証 ──
          // 名前一致だけで採用すると同名の別店（例: 別地域の "Chill Spot"）の写真・評価が混ざる。
          // 投稿の座標から500m超、座標が無ければ市区不一致のGoogle結果は破棄する。
          if (p) {
            const gLat = p.location?.latitude, gLng = p.location?.longitude;
            if (typeof baseLat === "number" && typeof baseLng === "number" &&
                typeof gLat === "number" && typeof gLng === "number") {
              if (haversineM(baseLat, baseLng, gLat, gLng) > 500) p = null;
            } else {
              const cityM = cleanAddr0.match(/^(?:東京都|北海道|大阪府|京都府|.{2,3}県)?(.+?[市区町村郡])/);
              if (cityM && !(p.formattedAddress ?? "").includes(cityM[1])) p = null;
            }
          }
          if (p) {
            placeId = p.id;
            phone = p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? "";
            website = p.websiteUri ?? "";
            googleMapsUri = googleMapsUri || (p.googleMapsUri ?? "");
            address = address || (p.formattedAddress ?? "");
            // ユーザー入力の営業時間があればそれを優先し、無い時だけGoogleで補完
            if (!openingHoursText) openingHoursText = (p.regularOpeningHours?.weekdayDescriptions ?? []).join("\n");
            googleRating = typeof p.rating === "number" ? p.rating : null;
            reviewCount = typeof p.userRatingCount === "number" ? p.userRatingCount : null;
            openNow = typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : null;
            if (typeof p.location?.latitude === "number") { placeLat = p.location.latitude; placeLng = p.location.longitude; }
            const photos = (p.photos ?? []) as Array<{ name: string }>;
            googlePhotos = photos.slice(0, 8).map((ph) => buildProxyUrl(origin, ph.name)).filter(Boolean);
            // 口コミ（Google は relevance 順 = 「ためになった」順で返す）
            type RawReview = {
              rating?: number;
              text?: { text?: string };
              authorAttribution?: { displayName?: string; photoUri?: string };
              relativePublishTimeDescription?: string;
            };
            reviews = ((p.reviews ?? []) as RawReview[])
              .map((r) => ({
                rating: typeof r.rating === "number" ? r.rating : null,
                text: r.text?.text ?? "",
                authorName: r.authorAttribution?.displayName ?? "Google ユーザー",
                authorPhoto: r.authorAttribution?.photoUri ?? null,
                relativeTime: r.relativePublishTimeDescription ?? "",
              }))
              .filter((r) => r.text.length > 5)
              .slice(0, 6);
          }
        }
      } catch { /* 補強失敗は無視 */ }
    }

    // 利用者写真が無ければ Google 写真で補強
    if (!hasUserPhotos) userPhotos = googlePhotos;

    // ── 最寄駅 + 徒歩時間 ───────────────────────────────────────────────────
    let stationText = stationSeed;
    if (!stationText && GOOGLE_API_KEY && typeof placeLat === "number" && typeof placeLng === "number") {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": "places.displayName,places.location",
          },
          body: JSON.stringify({
            includedTypes: ["train_station", "subway_station", "light_rail_station"],
            maxResultCount: 1,
            rankPreference: "DISTANCE",
            languageCode: "ja",
            locationRestriction: { circle: { center: { latitude: placeLat, longitude: placeLng }, radius: 2000 } },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const d = await res.json().catch(() => null);
          const st = d?.places?.[0];
          if (st?.location) {
            const distM = haversineM(placeLat, placeLng, st.location.latitude, st.location.longitude);
            const walkMin = Math.max(1, Math.round(distM / 80)); // 80m/分
            const stName = (st.displayName?.text ?? "")
              .replace(/\s*Station$/i, "")   // 英語表記の Station を除去
              .replace(/駅$/, "")
              .trim();
            stationText = `${stName}駅から徒歩約${walkMin}分`;
          }
        }
      } catch { /* 無視 */ }
    }

    // いいね/行った！数（穴場/Moodログ共通で spot_post_reactions を数える。テーブル未適用は0）
    let likeCount = 0;
    let visitedCount = 0;
    try {
      const { data: rxRows, error: lcErr } = await supabase.from("spot_post_reactions")
        .select("rtype").eq("post_id", realId).in("rtype", ["like", "visited"]);
      if (!lcErr) {
        for (const r of (rxRows ?? []) as Array<{ rtype?: string }>) {
          if (r.rtype === "like") likeCount++;
          else if (r.rtype === "visited") visitedCount++;
        }
      }
    } catch { /* 0のまま */ }

    // ── 期間限定イベント派生スポット("イベント名＠親スポット名")→ 親スポットへ導線＋親情報で補完 ──
    //   名前を「＠」で割った末尾が親スポット名。source_type=user の親を引き、名前タップの遷移先(parentPlaceId)を返す。
    //   イベント側の住所/営業時間/最寄駅が空なら親のもので補完＝「営業時間が無い/住所がおかしい」を解消。
    let parentPlaceId: string | null = null;
    let parentPlaceName: string | null = null;
    const atIdx = userTitle.lastIndexOf("＠");
    if (atIdx > 0) {
      const parentName = userTitle.slice(atIdx + 1).trim();
      if (parentName.length >= 2) {
        try {
          // 親はuser作成に限らない（Google/OSM/admin由来のこともある）ので source_type では絞らない。
          // is_active=true で抜け殻(削除済み)を除外し、同名複数はイベント座標に最も近い行を採用。
          const { data: pars } = await supabase.from("places")
            .select("id, name, address, open_hours, nearest_station, lat, lng")
            .eq("name", parentName)
            .eq("is_active", true)
            .limit(5);
          type ParRow = { id?: string; name?: string; address?: string | null; open_hours?: string | null; nearest_station?: string | null; lat?: number | null; lng?: number | null };
          const rows = (pars ?? []) as ParRow[];
          let pr: ParRow | null = rows[0] ?? null;
          if (rows.length > 1 && baseLat != null && baseLng != null) {
            pr = rows.slice().sort((a, b) => {
              const da = a.lat != null && a.lng != null ? haversineM(baseLat!, baseLng!, a.lat, a.lng) : Infinity;
              const db2 = b.lat != null && b.lng != null ? haversineM(baseLat!, baseLng!, b.lat, b.lng) : Infinity;
              return da - db2;
            })[0] ?? null;
          }
          if (pr?.id) {
            parentPlaceId = String(pr.id);
            parentPlaceName = String(pr.name ?? parentName);
            if (!address && pr.address) address = String(pr.address);
            if (!openingHoursText && pr.open_hours) openingHoursText = String(pr.open_hours);
            if (!stationText && pr.nearest_station) stationText = String(pr.nearest_station);
          }
        } catch { /* 親が見つからなくても詳細は表示する */ }
      }
    }

    // 住所は必ず何か出す: フル住所が空でも、拾えた都道府県だけは表示して行を隠さない（"必ず出す"要望）
    if (!address && prefecture) address = prefecture;

    // エッジキャッシュ: 詳細はGoogle補強が重いので60秒CDNに載せる
    //   （いいね/行った数の鮮度はクライアントが status POST(非キャッシュ)で上書きするため問題なし）
    return NextResponse.json({
      ok: true,
      spot: {
        id: respId,
        kind: isMoodlog ? "moodlog" : "suggestion",   // いいね/プロフィールのtargetId構築用
        likeCount,
        visitedCount,   // 行った！された回数（閲覧者が押した数）
        userTitle,            // 利用者が書いたスポット名
        placeName,            // 場所名（Google名 or 同じ）
        description,          // 利用者が書いた説明 / caption（大目玉）
        priceText,            // 目安価格（穴場のみ）
        rating,               // 投稿者のおすすめ度（★1-5・穴場のみ）
        googleRating,         // Google評価（平均）
        reviewCount,          // Google口コミ件数
        openNow,              // 営業中か
        reviews,              // Googleの口コミ（ためになった順）
        imageUrls: userPhotos,
        hasUserPhotos,
        address,
        phone,
        website,
        googleMapsUri,
        stationText,
        openingHoursText,
        prefecture,
        lat: placeLat,
        lng: placeLng,
        placeId,
        parentPlaceId,        // 期間限定イベントの親スポットID（名前タップの遷移先・無ければnull）
        parentPlaceName,      // 親スポット名
        autoTags,
        createdAt,
        availableFrom,        // 公開期間の開始（期間限定投稿時・穴場）
        availableUntil,       // 公開期間の終了
        posterName,           // 投稿者（匿名投稿はnull・生device_idは返さない）
        posterHandle,         // 投稿者の@ID（未設定はnull）
        posterIcon,           // 投稿者アイコン（ハッシュ名URL）
        posterId,             // 投稿者の公開ハッシュ（プロフィール/フォロー用・匿名はnull）
        posterType,           // 投稿者バッジ種別（official/store・未設定null）＝詳細でもバッジを出す
        isMine,               // 閲覧者が投稿者本人か（本人には匿名でも自分の表示を出す）
        visibility: postVisibility,   // 公開範囲（本人向けに「匿名で公開中」等の表示に使う・他者には影響なし）
      },
      // viewerHash 付きは本人向けに内容が変わるため CDN 共有キャッシュしない（本人の匿名投稿情報の混在防止）
    }, { headers: { "Cache-Control": viewerHash ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=600" } });
  } catch (e) {
    console.error("[community-spot]", e);
    // Supabaseエラー等のオブジェクトを "[object Object]" にしない（監視ログの可読性）
    const msg = e instanceof Error ? e.message
      : (e && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message) : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
