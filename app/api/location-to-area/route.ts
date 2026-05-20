export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

type RequestBody = {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: GoogleGeocodeResult[];
};

function pickAreaFromResult(result?: GoogleGeocodeResult) {
  if (!result) return null;

  const components = result.address_components ?? [];

  // 指定したtypeをすべて持つコンポーネントのlong_nameを返す
  const findByTypes = (types: string[]) => {
    const found = components.find((c) => types.every((t) => c.types.includes(t)));
    return found?.long_name ?? null;
  };

  // いずれかのtypeセットにマッチする最初のlong_nameを返す
  const findLongName = (...typeSets: string[][]) => {
    for (const types of typeSets) {
      const v = findByTypes(types);
      if (v) return v;
    }
    return null;
  };

  const admin1     = findLongName(["administrative_area_level_1"]);
  const admin2     = findLongName(["administrative_area_level_2"]);
  const locality   = findLongName(["locality"]);
  // 区（ward）を優先、次にsublocality_level_1
  const sublocality1 = findLongName(["sublocality_level_1", "ward"], ["sublocality_level_1"], ["ward"]);
  const sublocality2 = findByTypes(["sublocality_level_2"]);
  const sublocality3 = findByTypes(["sublocality_level_3"]);
  const sublocality4 = findByTypes(["sublocality_level_4"]);
  const neighborhood = findByTypes(["neighborhood"]);
  const premise      = findByTypes(["premise"]);

  const city     = locality || admin2 || null;
  const district = sublocality1 || null;

  // 町名レベル（sublocality_level_2）を検索エリアに使う
  const townName = sublocality2 || neighborhood || null;

  // 検索用エリア: 市区＋町名まで（番地以下は含めない）
  let searchArea: string | null = null;
  if (city && district && townName) {
    searchArea = `${city}${district}${townName}`;
  } else if (city && district) {
    searchArea = `${city}${district}`;
  } else if (city && townName) {
    searchArea = `${city}${townName}`;
  } else if (district && townName) {
    searchArea = `${district}${townName}`;
  } else {
    searchArea = townName || district || city || admin1 || null;
  }

  // 表示用の詳細住所: 都道府県〜番地・号まで全部結合
  const detailParts = [sublocality2, sublocality3, sublocality4, premise].filter(Boolean);
  let displayArea: string | null = null;
  if (admin1 && city && district && detailParts.length > 0) {
    displayArea = `${admin1}${city}${district}${detailParts.join("")}`;
  } else if (admin1 && city && district) {
    displayArea = `${admin1}${city}${district}`;
  } else if (city && district) {
    displayArea = `${city}${district}`;
  } else {
    displayArea = searchArea;
  }

  return {
    area: searchArea,
    displayArea,
    locality,
    ward: sublocality1,
    neighborhood: townName,
    prefecture: admin1,
    formattedAddress: result.formatted_address ?? null,
  };
}

async function reverseGeocode(latitude: number, longitude: number) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "GOOGLE_MAPS_API_KEY が .env.local にありません。",
      },
      { status: 500 }
    );
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${latitude},${longitude}`);
  url.searchParams.set("language", "ja");
  url.searchParams.set("region", "jp");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const data =
    (await res.json().catch(() => null)) as GoogleGeocodeResponse | null;

  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Geocoding API の呼び出しに失敗しました。",
        detail: data,
      },
      { status: 502 }
    );
  }

  if (!data || data.status !== "OK" || !data.results?.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "位置情報からエリアを特定できませんでした。",
        googleStatus: data?.status ?? "UNKNOWN_ERROR",
        googleMessage: data?.error_message ?? null,
      },
      { status: 404 }
    );
  }

  const picked = pickAreaFromResult(data.results[0]);

  if (!picked?.area) {
    return NextResponse.json(
      {
        ok: false,
        error: "住所候補は取れましたが、エリア名に変換できませんでした。",
        formattedAddress: picked?.formattedAddress ?? null,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    area: picked.area,
    displayArea: picked.displayArea,
    locality: picked.locality,
    ward: picked.ward,
    neighborhood: picked.neighborhood,
    prefecture: picked.prefecture,
    formattedAddress: picked.formattedAddress,
    latitude,
    longitude,
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const latitude = Number(searchParams.get("latitude") ?? searchParams.get("lat"));
    const longitude = Number(searchParams.get("longitude") ?? searchParams.get("lng"));

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({
        ok: true,
        message:
          "location-to-area route is alive. GETで試すなら /api/location-to-area?latitude=35.4437&longitude=139.6380 のように開いてください。",
      });
    }

    return reverseGeocode(latitude, longitude);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "GET /api/location-to-area でエラーが発生しました。",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null;

    const latitude =
      typeof body?.latitude === "number"
        ? body.latitude
        : typeof body?.lat === "number"
          ? body.lat
          : NaN;

    const longitude =
      typeof body?.longitude === "number"
        ? body.longitude
        : typeof body?.lng === "number"
          ? body.lng
          : NaN;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json(
        {
          ok: false,
          error: "latitude / longitude が不正です。",
        },
        { status: 400 }
      );
    }

    return reverseGeocode(latitude, longitude);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "POST /api/location-to-area でエラーが発生しました。",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
