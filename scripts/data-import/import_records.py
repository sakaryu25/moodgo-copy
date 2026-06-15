import urllib.request, urllib.parse, json, os, re, time, sys

# 汎用インポーター: records JSON を Supabase places へ upsert
#   record = {name, address?, lat?, lng?, tags:[...], area?, source}
#   - 同名は「同じ都道府県の既存行」のみ上書き（タグはマージ）、無ければ新規
#   - 座標が無く住所があれば GSI で無料ジオコーディング（cache）
#   - PostgRESTバッチinsertは全行同一キー必須 → lat/lng/nearest_station は常にキーを持たせる
#   使い方: python3 import_records.py <records.json> [sourceLabel]

SU = os.environ["SUPABASE_URL"].rstrip("/")
SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}
GEOCACHE = "/tmp/geocache.json"

records = json.load(open(sys.argv[1]))
SRC_DEFAULT = sys.argv[2] if len(sys.argv) > 2 else "opendata"
gcache = json.load(open(GEOCACHE)) if os.path.exists(GEOCACHE) else {}

PREF_RE = re.compile(r"(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)")

def norm(s): return re.sub(r"\s+", "", (s or "")).strip().lower()
def pref_of(addr):
    m = PREF_RE.search(addr or ""); return m.group(1) if m else ""

def http(method, path, body=None, extra=None):
    h = dict(H)
    if extra: h.update(extra)
    req = urllib.request.Request(SU + "/rest/v1/" + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=60); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def load_existing():
    idx = {}; off = 0
    while True:
        st, raw = http("GET", f"places?select=id,name,address,tags&limit=1000&offset={off}")
        rows = json.loads(raw)
        if not rows: break
        for row in rows: idx.setdefault(norm(row["name"]), []).append(row)
        off += 1000
        if len(rows) < 1000: break
    return idx

def geocode(addr):
    a = (addr or "").strip()
    if not a: return (None, None)
    if a in gcache: return tuple(gcache[a]) if gcache[a] else (None, None)
    res = None
    try:
        url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(a)
        arr = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "MoodGo"}), timeout=20).read())
        if arr and arr[0].get("geometry"):
            lng, lat = arr[0]["geometry"]["coordinates"][:2]
            if -90 < lat < 90 and 120 < lng < 155: res = [float(lat), float(lng)]
    except Exception:
        res = None
    gcache[a] = res
    time.sleep(0.1)
    return tuple(res) if res else (None, None)

def insert_chunk(rows):
    if not rows: return 0
    st, raw = http("POST", "places", rows, {"Prefer": "return=minimal"})
    if st in (200, 201): return len(rows)
    ok = 0
    for r in rows:
        s2, b2 = http("POST", "places", [r], {"Prefer": "return=minimal"})
        if s2 in (200, 201): ok += 1
        else: print("   行INSERT失敗", r.get("name"), s2, b2[:100], flush=True)
    return ok

print("既存索引ロード中...", flush=True)
existing = load_existing()
print("既存ユニーク名:", len(existing), flush=True)

upd = ins = geo_ok = geo_ng = skipped = 0
buf = []
seen_in_run = set()
for rec in records:
    name = (rec.get("name") or "").strip()
    if not name: continue
    tags = rec.get("tags") or []
    area = (rec.get("area") or "").strip()
    addr = (rec.get("address") or area or "日本").strip()
    pref = pref_of(addr) or pref_of(area) or area
    lat, lng = rec.get("lat"), rec.get("lng")
    if (lat is None or lng is None):
        g = geocode(addr)
        if g[0] is not None: lat, lng = g; geo_ok += 1
        else: geo_ng += 1
    # 実行内の重複（同名同県）も防ぐ
    rk = norm(name) + "|" + (pref or "")
    cands = existing.get(norm(name), [])
    match = next((c for c in cands if pref and pref in (c.get("address") or "")), None) if cands else None
    if match:
        merged = sorted(set((match.get("tags") or []) + tags))
        body = {"tags": merged, "address": addr, "area": area or pref or None, "source_type": rec.get("source") or SRC_DEFAULT, "is_active": True}
        if lat is not None: body["lat"] = lat; body["lng"] = lng
        s2, b2 = http("PATCH", f"places?id=eq.{match['id']}", body, {"Prefer": "return=minimal"})
        if s2 in (200, 204): upd += 1
        else: print("   更新失敗", name, s2, b2[:100], flush=True)
    else:
        if rk in seen_in_run: skipped += 1; continue
        seen_in_run.add(rk)
        buf.append({"name": name, "address": addr, "tags": tags, "area": area or pref or None,
                    "nearest_station": None, "source_type": rec.get("source") or SRC_DEFAULT,
                    "is_active": True, "lat": lat, "lng": lng})
    if len(buf) >= 200:
        ins += insert_chunk(buf); buf = []
        if geo_ok+geo_ng>0: json.dump(gcache, open(GEOCACHE, "w"))
ins += insert_chunk(buf)
if geo_ok+geo_ng>0: json.dump(gcache, open(GEOCACHE, "w"))
print(f"\n=== 完了: 更新{upd} / 新規{ins} / geo成功{geo_ok} 失敗{geo_ng} / 実行内重複skip{skipped} ===", flush=True)
