import urllib.request, urllib.parse, json, time

ENDPOINT = "https://query.wikidata.org/sparql"
UA = "MoodGoDataImport/1.0 (https://moodgo-qvmk.vercel.app; kento.ryuto25@gmail.com)"

# カテゴリ: Wikidataクラス, 付与タグ, 直接instanceか(P279*を辿らない), ja記事必須か, LIMIT
CATS = [
  {"q": "Q177380",  "tags": ["#まったりしたい", "#温泉"],                          "sub": True,  "article": False, "limit": 4000, "label": "温泉"},
  {"q": "Q34038",   "tags": ["#自然感じたい", "#滝"],                              "sub": True,  "article": False, "limit": 4000, "label": "滝"},
  {"q": "Q40080",   "tags": ["#自然感じたい", "#海"],                              "sub": True,  "article": False, "limit": 4000, "label": "海岸ビーチ"},
  {"q": "Q170321",  "tags": ["#自然感じたい", "#湿原"],                            "sub": True,  "article": False, "limit": 3000, "label": "湿原"},
  {"q": "Q8502",    "tags": ["#自然感じたい", "#山", "#体動かしたい"],             "sub": False, "article": True,  "limit": 6000, "label": "山(記事あり)"},
  {"q": "Q174782",  "tags": ["#わいわい楽しみたい", "#スリル味わいたい", "#絶叫"], "sub": True,  "article": False, "limit": 2000, "label": "遊園地"},
  {"q": "Q2870166", "tags": ["#わいわい楽しみたい", "#スリル味わいたい"],          "sub": True,  "article": False, "limit": 2000, "label": "テーマパーク"},
  {"q": "Q1440476", "tags": ["#自然感じたい", "#スリル味わいたい", "#高所", "#絶景"], "sub": True, "article": False, "limit": 2000, "label": "展望タワー"},
  {"q": "Q1338210", "tags": ["#自然感じたい", "#スリル味わいたい", "#高所", "#絶景"], "sub": True, "article": False, "limit": 2000, "label": "展望台"},
  {"q": "Q9259",    "tags": ["#遠くに行きたい", "#世界遺産"],                      "sub": True,  "article": False, "limit": 2000, "label": "世界遺産"},
]

def query(cat):
    p31 = "wdt:P31/wdt:P279*" if cat["sub"] else "wdt:P31"
    article = ('?art schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> .' if cat["article"] else '')
    q = f"""
SELECT ?item ?itemLabel ?coord ?prefLabel WHERE {{
  ?item {p31} wd:{cat['q']} .
  ?item wdt:P17 wd:Q17 .
  ?item wdt:P625 ?coord .
  {article}
  OPTIONAL {{ ?item wdt:P131* ?pref . ?pref wdt:P31 wd:Q50337 . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ja". }}
}} LIMIT {cat['limit']}"""
    url = ENDPOINT + "?format=json&query=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    r = urllib.request.urlopen(req, timeout=120)
    return json.loads(r.read())

def parse_point(wkt):
    m = wkt.strip()
    if not m.startswith("Point("): return None
    try:
        lng, lat = m[6:-1].split()
        return float(lat), float(lng)
    except Exception:
        return None

records = []
seen = set()
for cat in CATS:
    try:
        data = query(cat)
    except Exception as e:
        print(f"  {cat['label']}: クエリ失敗 {e}", flush=True); time.sleep(2); continue
    rows = data.get("results", {}).get("bindings", [])
    n = 0
    for b in rows:
        uri = b["item"]["value"]
        name = b.get("itemLabel", {}).get("value", "")
        if not name or name.startswith("Q") and name[1:].isdigit():
            continue  # ja名なし
        if not any(0x3040 <= ord(ch) <= 0x9fff for ch in name) and not any(c.isalpha() for c in name):
            continue
        coord = b.get("coord", {}).get("value", "")
        ll = parse_point(coord)
        if not ll: continue
        pref = b.get("prefLabel", {}).get("value", "")
        if pref.startswith("Q") and pref[1:].isdigit(): pref = ""
        key = uri + "|" + ",".join(cat["tags"][:1])
        if key in seen: continue
        seen.add(key)
        records.append({
            "name": name.strip()[:120],
            "address": (pref or "日本"),
            "area": pref or None,
            "lat": ll[0], "lng": ll[1],
            "tags": cat["tags"],
            "source": "wikidata",
        })
        n += 1
    print(f"  {cat['label']}: {n}件", flush=True)
    time.sleep(1.5)

json.dump(records, open("/tmp/wikidata_records.json", "w"), ensure_ascii=False)
print(f"\n=== Wikidata合計 {len(records)}件 → /tmp/wikidata_records.json ===", flush=True)
