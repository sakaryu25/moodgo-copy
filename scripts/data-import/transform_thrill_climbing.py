#!/usr/bin/env python3
"""
osm_thrill_raw.json の climbing(クライミング/ボルダリングジム)を import_records.py 用に変換。
座標しか無いので GSI逆ジオコーディングで都道府県+住所を付与（県でdedupするため必須）。
出力: climbing_records.json  [{name, address, lat, lng, tags, source}]
"""
import json, time, os, urllib.request, urllib.parse

SRC = os.path.join(os.path.dirname(__file__), "osm_thrill_raw.json")
OUT = os.path.join(os.path.dirname(__file__), "climbing_records.json")
TAGS = ["#スリル味わいたい", "#体動かしたい"]  # クライミング=スリル(高さ)かつ運動
PREF = {  # JIS市区町村コード先頭2桁→都道府県
 "01":"北海道","02":"青森県","03":"岩手県","04":"宮城県","05":"秋田県","06":"山形県","07":"福島県",
 "08":"茨城県","09":"栃木県","10":"群馬県","11":"埼玉県","12":"千葉県","13":"東京都","14":"神奈川県",
 "15":"新潟県","16":"富山県","17":"石川県","18":"福井県","19":"山梨県","20":"長野県","21":"岐阜県",
 "22":"静岡県","23":"愛知県","24":"三重県","25":"滋賀県","26":"京都府","27":"大阪府","28":"兵庫県",
 "29":"奈良県","30":"和歌山県","31":"鳥取県","32":"島根県","33":"岡山県","34":"広島県","35":"山口県",
 "36":"徳島県","37":"香川県","38":"愛媛県","39":"高知県","40":"福岡県","41":"佐賀県","42":"長崎県",
 "43":"熊本県","44":"大分県","45":"宮崎県","46":"鹿児島県","47":"沖縄県"}

def rev(lat, lng):
    url = f"https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={lat}&lon={lng}"
    for a in range(3):
        try:
            j = json.loads(urllib.request.urlopen(urllib.request.Request(
                url, headers={"User-Agent": "moodgo-enrichment/1.0"}), timeout=20).read())
            r = j.get("results") or {}
            muni = str(r.get("muniCd") or "").zfill(5)
            pref = PREF.get(muni[:2], "")
            return pref, (r.get("lv01Nm") or "")
        except Exception:
            time.sleep(1)
    return "", ""

clim = [r for r in json.load(open(SRC)) if r["cat"] == "climbing"]
out = []
for i, r in enumerate(clim):
    pref, sub = rev(r["lat"], r["lng"])
    addr = (pref + sub).strip() or "日本"
    out.append({"name": r["name"], "address": addr, "lat": r["lat"], "lng": r["lng"],
                "tags": TAGS, "area": pref or None, "source": "osm-climbing"})
    if (i + 1) % 40 == 0:
        print(f"  ...{i+1}/{len(clim)} 逆ジオ済", flush=True)
    time.sleep(0.15)
json.dump(out, open(OUT, "w"), ensure_ascii=False)
from collections import Counter
pc = Counter(r["area"] for r in out)
print(f"=== 変換完了: {len(out)} 件 -> {OUT} ===")
print("県別:", dict(sorted(pc.items(), key=lambda x: -(x[1] or 0))[:10]))
print("住所付与失敗(日本のまま):", sum(1 for r in out if r["address"] == "日本"))
