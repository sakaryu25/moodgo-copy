import urllib.request, urllib.parse, json, time
EP="https://overpass-api.de/api/interpreter"; BBOX="24,122,46,154"
CATS=[
 ('leisure','sports_centre',["#体動かしたい","#スポーツ"]),
 ('leisure','fitness_centre',["#体動かしたい","#ジム"]),
 ('leisure','stadium',["#体動かしたい","#スポーツ"]),
 ('leisure','sports_hall',["#体動かしたい","#スポーツ"]),
 ('leisure','swimming_pool',["#体動かしたい","#プール"]),
 ('leisure','ice_rink',["#体動かしたい","#わいわい楽しみたい"]),
 ('leisure','golf_course',["#体動かしたい","#ゴルフ"]),
]
def run(k,v):
    q=f'[out:json][timeout:180];(node["{k}"="{v}"]({BBOX});way["{k}"="{v}"]({BBOX}););out center tags;'
    req=urllib.request.Request(EP,data=urllib.parse.urlencode({'data':q}).encode(),headers={'User-Agent':'MoodGo/1.0 (kento.ryuto25@gmail.com)'})
    for a in range(3):
        try: return json.loads(urllib.request.urlopen(req,timeout=200).read())
        except Exception as e:
            if a<2: time.sleep(20); continue
            raise
recs=[]; seen=set()
for i,(k,v,tags) in enumerate(CATS):
    if i>0: time.sleep(8)
    try: d=run(k,v)
    except Exception as e: print(k,v,"失敗",e,flush=True); continue
    n=0
    for el in d.get("elements",[]):
        t=el.get("tags",{}); name=(t.get("name:ja") or t.get("name") or "").strip()
        if not name or not any(0x3040<=ord(c)<=0x9fff or 0x30a0<=ord(c)<=0x30ff for c in name): continue
        lat=el.get("lat") or (el.get("center") or {}).get("lat"); lng=el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None: continue
        pref=t.get("addr:province") or ""
        addr=(pref+(t.get("addr:city") or "")+(t.get("addr:full") or t.get("addr:street") or "")) or pref or "日本"
        key=name+"|"+f"{round(lat,3)},{round(lng,3)}"
        if key in seen: continue
        seen.add(key)
        recs.append({"name":name[:120],"address":addr,"area":pref or None,"lat":float(lat),"lng":float(lng),"tags":tags,"source":"osm"})
        n+=1
    print(f"{k}={v}: {n}件",flush=True)
json.dump(recs,open("/tmp/osm_sports_records.json","w"),ensure_ascii=False)
print("=== OSMスポーツ合計",len(recs),"件 ===",flush=True)
