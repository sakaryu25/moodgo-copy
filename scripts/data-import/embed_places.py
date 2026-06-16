#!/usr/bin/env python3
# 全 places の「名前＋説明＋タグ」を text-embedding-3-small でベクトル化し places.embedding に投入。
#   ⚠ 先に supabase/semantic-search.sql を適用（embeddingカラム＋set_place_embeddings RPC）。
#   embedding が null の行だけ処理＝再実行で続きから（冪等・レジューム可）。
#   使い方: SUPABASE_URL / SUPABASE_SERVICE_KEY / OPENAI_API_KEY を環境変数に入れて
#           python3 embed_places.py
import os, json, time, urllib.request, urllib.error

SU = os.environ["SUPABASE_URL"].rstrip("/")
SK = os.environ["SUPABASE_SERVICE_KEY"]
OK = os.environ["OPENAI_API_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}
BATCH = 200

def http(method, path, body=None, extra=None):
    h = dict(H)
    if extra: h.update(extra)
    req = urllib.request.Request(SU + "/rest/v1/" + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=h, method=method)
    for a in range(4):
        try:
            r = urllib.request.urlopen(req, timeout=120); return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:
            if a < 3: time.sleep(5); continue
            return 0, str(e).encode()

def embed(texts):
    body = {"model": "text-embedding-3-small", "input": texts}
    req = urllib.request.Request("https://api.openai.com/v1/embeddings", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + OK, "Content-Type": "application/json"}, method="POST")
    for a in range(5):
        try:
            r = urllib.request.urlopen(req, timeout=120); d = json.load(r)
            return [x["embedding"] for x in d["data"]]
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                print(f"   OpenAI {e.code} retry in {10*(a+1)}s", flush=True); time.sleep(min(60, 10 * (a + 1))); continue
            raise
        except Exception:
            if a < 4: time.sleep(10); continue
            raise

def build_text(r):
    name = r.get("name") or ""
    desc = r.get("description") or ""
    if desc == f"{name}のスポット情報": desc = ""   # 定型フォールバックはノイズ
    tags = " ".join([t for t in (r.get("tags") or []) if isinstance(t, str)])
    t = (name + "。" + desc + "。" + tags).strip("。 ").strip()
    return (t or name or "スポット")[:500]

total = 0
while True:
    st, raw = http("GET", f"places?select=id,name,description,tags&embedding=is.null&limit={BATCH}")
    if st != 200:
        print("GET失敗", st, raw[:120], flush=True); break
    rows = json.loads(raw)
    if not rows: break
    texts = [build_text(r) for r in rows]
    try:
        vecs = embed(texts)
    except Exception as e:
        print("embed失敗・中断", e, flush=True); break
    ids = [r["id"] for r in rows]
    embs = ["[" + ",".join(f"{x:.6f}" for x in v) + "]" for v in vecs]
    # HNSW索引があると per-row UPDATE が重く、大きいバッチは statement timeout(57014)。
    #   40行ずつ書き込んで各RPCを短時間に収める（索引をdropすれば速いが、無くても確実に完走する）。
    WRITE = 40
    failed = False
    for j in range(0, len(ids), WRITE):
        st2, raw2 = http("POST", "rpc/set_place_embeddings", {"ids": ids[j:j + WRITE], "embs": embs[j:j + WRITE]})
        if st2 not in (200, 204):
            print("RPC失敗・中断", st2, raw2[:160], flush=True); failed = True; break
        time.sleep(0.1)
    if failed: break
    total += len(rows)
    if total % 2000 == 0 or len(rows) < BATCH:
        print(f"  embedded {total}", flush=True)
    time.sleep(0.25)

print(f"=== 完了 {total}件 埋め込み投入 ===", flush=True)
