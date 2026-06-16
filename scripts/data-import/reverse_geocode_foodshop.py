#!/usr/bin/env python3
# osm-foodshop で住所が「日本」だけの行を、座標→GSI逆ジオコーディングで
# 「都道府県+市区町村+町丁目」に補完する（area=都道府県も埋める）。
#   ・GSI LonLatToAddress → muniCd + lv01Nm。muniCd は GSI muni.js で「都道府県,市区町村」に変換。
#   ・座標を3桁(≈111m)に丸めた cache でGSI呼び出しを激減（同ブロックの多数店舗は1回）。
#   ・address が「日本」の行だけ対象＝再実行で残りだけ処理（冪等・レジューム可）。
#   使い方: SUPABASE_URL/SUPABASE_SERVICE_KEY を環境変数に入れて
#           python3 reverse_geocode_foodshop.py
import os, re, json, time, threading, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

SU = os.environ["SUPABASE_URL"].rstrip("/"); SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK}
UA = {"User-Agent": "MoodGo/1.0 (kento.ryuto25@gmail.com)"}
CACHE = "/tmp/revgeo_cache.json"

# ── GSI 市区町村マスタ（muniCd → (都道府県, 都道府県+市区町村)）──
mt = urllib.request.urlopen(urllib.request.Request("https://maps.gsi.go.jp/js/muni.js", headers=UA), timeout=30).read().decode("utf-8")
MUNI = {}
for code, val in re.findall(r'MUNI_ARRAY\["(\d+)"\]\s*=\s*\'([^\']*)\'', mt):
    p = val.split(",")
    if len(p) >= 4:
        pref = p[1]; mn = p[3].replace("　", "")  # 全角スペース除去（"札幌市　中央区"→"札幌市中央区"）
        MUNI[code] = (pref, pref + mn)
print("muni codes:", len(MUNI), flush=True)

cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
lock = threading.Lock()

def gsi_addr(lat, lng):
    key = f"{round(lat,3)},{round(lng,3)}"
    with lock:
        if key in cache: return tuple(cache[key])
    pref = addr = ""
    try:
        u = f"https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={lat}&lon={lng}"
        d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20).read())
        res = d.get("results") or {}
        mc = str(res.get("muniCd") or "")
        pm = MUNI.get(mc) or MUNI.get(mc.lstrip("0"))
        town = res.get("lv01Nm") or ""
        if town in ("-", "—"): town = ""
        if pm:
            pref, base = pm; addr = base + town
    except Exception:
        pass
    with lock:
        cache[key] = [pref, addr]
    time.sleep(0.08)  # cache miss 時のみ礼儀スリープ
    return pref, addr

def patch(pid, addr, area):
    body = json.dumps({"address": addr, "area": area or None}).encode()
    req = urllib.request.Request(SU + "/rest/v1/places?id=eq." + pid, data=body,
                                 headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"}, method="PATCH")
    try:
        urllib.request.urlopen(req, timeout=30); return True
    except Exception:
        return False

# ── 対象（address='日本' の osm-foodshop）を全件取得 ──
def fetch_targets():
    rows = []; off = 0
    while True:
        u = (SU + "/rest/v1/places?select=id,lat,lng&source_type=eq.osm-foodshop&address=eq."
             + urllib.parse.quote("日本") + f"&limit=1000&offset={off}")
        d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=60).read())
        if not d: break
        rows += d; off += 1000
        if len(d) < 1000: break
    return rows

targets = fetch_targets()
print("対象", len(targets), flush=True)
done = [0]

def work(row):
    lat, lng = row.get("lat"), row.get("lng")
    if lat is None or lng is None: return 0
    pref, addr = gsi_addr(lat, lng)
    res = 1 if (addr and patch(str(row["id"]), addr, pref)) else 0
    with lock:
        done[0] += 1
        if done[0] % 2000 == 0:
            json.dump(cache, open(CACHE, "w"), ensure_ascii=False)
            print(f"  {done[0]}/{len(targets)} cache={len(cache)}", flush=True)
    return res

with ThreadPoolExecutor(max_workers=6) as ex:
    results = list(ex.map(work, targets))
json.dump(cache, open(CACHE, "w"), ensure_ascii=False)
print(f"=== 完了 patched {sum(results)}/{len(targets)} cache={len(cache)} ===", flush=True)
