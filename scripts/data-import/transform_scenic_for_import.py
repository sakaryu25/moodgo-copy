#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fetch_osm_scenic.py の出力(/tmp/osm_scenic.json)を import_records.py の入力形式へ変換。
import_records は [{name, address, lat, lng, tags, source}] の配列を読む。
source_type は "osm-scenic"（後で source_type で識別・可逆削除できる）。
出力: /tmp/scenic_import.json
"""
import json, os, sys
IN = os.environ.get("IN", "/tmp/osm_scenic.json")
OUT = os.environ.get("OUT", "/tmp/scenic_import.json")
d = json.load(open(IN))
recs = d.get("records", []) if isinstance(d, dict) else d
out = []
for r in recs:
    nm = (r.get("name") or "").strip()
    if not nm or r.get("lat") is None or r.get("lng") is None:
        continue
    out.append({
        "name": nm,
        "address": r.get("addr") or r.get("prefecture") or "日本",
        "lat": r.get("lat"), "lng": r.get("lng"),
        "tags": r.get("tags") or ["#自然感じたい"],
        "area": r.get("prefecture") or "",
        "source": "osm-scenic",
    })
json.dump(out, open(OUT, "w"), ensure_ascii=False)
from collections import Counter
k = Counter(t for r in out for t in r["tags"] if t != "#自然感じたい" and t != "#絶景スポット")
print(f"変換: {len(out)}件 → {OUT}")
print("サブタグ内訳:", dict(k))
