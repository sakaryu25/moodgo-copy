#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QA検出のminor誤爆を名前ベースでDB補正（id維持）。
  osm-sports #ジム: ヨガ/ダンス/卓球/テニス/ゴルフ/バッティング等を除去（fitness_centreが広いため）
  osm-shopping #古着: 古本/書店/工具/マンガ等を除去（second_handが広いため）
  osm-shopping #雑貨インテリア: カフェ/たばこ等を除去（variety_storeが広いため）
"""
import urllib.request, urllib.error, json, os, re, time
from concurrent.futures import ThreadPoolExecutor
import threading

SU = os.environ["SUPABASE_URL"].rstrip("/"); SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}

def http(method, path, body=None, extra=None):
    h = dict(H)
    if extra: h.update(extra)
    req = urllib.request.Request(SU + "/rest/v1/" + path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    for a in range(4):
        try:
            r = urllib.request.urlopen(req, timeout=120); return r.status, r.read()
        except urllib.error.HTTPError as e: return e.code, e.read()
        except Exception:
            if a < 3: time.sleep(3); continue
            return 0, b""

def enc(tag): return urllib.parse.quote('{"' + tag + '"}')
import urllib.parse

# (source_type, 対象タグ, 除去条件regex, 除外regex=これに該当なら除去しない)
RULES = [
    ("osm-sports", "#ジム",
     re.compile(r"ヨガ|ピラティス|ホットヨガ|ダンス|卓球|テニス|ゴルフ|バッティング|乗馬|スイミング|空手|柔道|剣道|ボクシング"),
     re.compile(r"ジム|フィットネス|トレーニング|GYM|gym")),
    ("osm-shopping", "#古着",
     re.compile(r"古本|書店|工具|マンガ|漫画|ホビー|本舗|ブックオフ|ハードオフ"),
     re.compile(r"古着|ヴィンテージ|ビンテージ|アパレル|衣料|セカンドストリート|ユーズド")),
    ("osm-shopping", "#雑貨インテリア",
     re.compile(r"カフェ|喫茶|たばこ|タバコ|煙草|ラーメン|食堂"),
     re.compile(r"雑貨|インテリア|家具|生活")),
]

lock = threading.Lock()
for src, tag, cond, excl in RULES:
    rows = []; off = 0
    while True:
        st, raw = http("GET", f"places?source_type=eq.{src}&tags=cs.{enc(tag)}&select=id,name,tags&limit=1000&offset={off}")
        try: data = json.loads(raw)
        except Exception: break
        if not data: break
        rows.extend(data); off += 1000
        if len(data) < 1000: break
    fixes = []
    for r in rows:
        nm = r.get("name") or ""
        if cond.search(nm) and not excl.search(nm):
            fixes.append({"id": r["id"], "tags": [t for t in (r.get("tags") or []) if t != tag]})
    print(f"[{src} {tag}] 保持{len(rows)} → 補正{len(fixes)}", flush=True)
    done = [0]
    def patch(row):
        s, _ = http("PATCH", f"places?id=eq.{row['id']}", {"tags": row["tags"]}, {"Prefer": "return=minimal"})
        with lock: done[0] += 1
        return s in (200, 204)
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(patch, fixes))
print("=== 完了 ===", flush=True)
