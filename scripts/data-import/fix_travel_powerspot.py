#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""osm-travel の #パワースポット を神社寺のみに絞る（教会/記念碑/像/城跡等から除去）。
QAで#パワースポット24%FP（教会/記念碑混入）が判明したが、deriver修正後も古い行が残るため
名前ベースでDBを直接補正する。id維持のbulk upsert。"""
import urllib.request, urllib.error, json, os, re, time
from concurrent.futures import ThreadPoolExecutor
import threading

SU = os.environ["SUPABASE_URL"].rstrip("/"); SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}
# 日本の神社寺パターン（これに該当しなければ#パワースポットを外す）
SHRINE = re.compile(r"神社|神宮|大社|稲荷|八幡|天満|東照|八坂|諏訪|住吉|熊野|日吉|愛宕|宮$|宮神社|"
                    r"寺|大師|不動|観音|薬師|地蔵|権現|明神|弁天|別院|本願寺|お寺|庵$|院$|堂$")

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

# #パワースポットを持つ osm-travel 行を全部読む
rows = []; off = 0
while True:
    st, raw = http("GET", f"places?source_type=eq.osm-travel&tags=cs.%7B%22%23%E3%83%91%E3%83%AF%E3%83%BC%E3%82%B9%E3%83%9D%E3%83%83%E3%83%88%22%7D&select=id,name,tags&limit=1000&offset={off}")
    try: data = json.loads(raw)
    except Exception: break
    if not data: break
    rows.extend(data); off += 1000
    if len(data) < 1000: break
print(f"#パワースポット保持 osm-travel: {len(rows)}件", flush=True)

# 神社寺でないものは#パワースポットを外す
fixes = []
for r in rows:
    if not SHRINE.search(r.get("name") or ""):
        tags = [t for t in (r.get("tags") or []) if t != "#パワースポット"]
        if not any(t for t in tags if t != "#お腹すいた" and t != "#遠くに行きたい"):
            tags = tags  # #遠くに行きたい は残す
        fixes.append({"id": r["id"], "tags": tags})
print(f"補正対象（神社寺でない）: {len(fixes)}件", flush=True)

lock = threading.Lock(); done = [0]
def patch(row):
    s, _ = http("PATCH", f"places?id=eq.{row['id']}", {"tags": row["tags"]}, {"Prefer": "return=minimal"})
    with lock:
        done[0] += 1
        if done[0] % 2000 == 0: print(f"  {done[0]}/{len(fixes)}", flush=True)
    return s in (200, 204)

with ThreadPoolExecutor(max_workers=8) as ex:
    list(ex.map(patch, fixes))
print(f"=== 完了: {len(fixes)}件から#パワースポット除去 ===", flush=True)
