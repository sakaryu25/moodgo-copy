import urllib.request, urllib.parse, json, time
ENDPOINT="https://query.wikidata.org/sparql"
UA="MoodGoDataImport/1.0 (https://moodgo-qvmk.vercel.app; kento.ryuto25@gmail.com)"
CATS=[
 {"q":"Q34038","tags":["#自然感じたい","#滝"],"label":"滝","limit":4000},
 {"q":"Q1066984","tags":["#ドライブしたい","#道の駅","#まったりしたい"],"label":"道の駅","limit":2000},
 {"q":"Q43501","tags":["#わいわい楽しみたい","#動物園"],"label":"動物園","limit":1000},
 {"q":"Q39614","tags":["#わいわい楽しみたい","#水族館"],"label":"水族館","limit":600},
 {"q":"Q33506","tags":["#遠くに行きたい","#博物館"],"label":"博物館","limit":4000},
]
def q(c):
    s=f'''SELECT ?item ?itemLabel ?coord ?prefLabel WHERE {{
 ?item wdt:P31/wdt:P279* wd:{c['q']} . ?item wdt:P17 wd:Q17 . ?item wdt:P625 ?coord .
 OPTIONAL {{ ?item wdt:P131* ?pref . ?pref wdt:P31 wd:Q50337 . }}
 SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ja". }} }} LIMIT {c['limit']}'''
    url=ENDPOINT+"?format=json&query="+urllib.parse.quote(s)
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/sparql-results+json"})
    for a in range(4):
        try: return json.loads(urllib.request.urlopen(req,timeout=120).read())
        except urllib.error.HTTPError as e:
            if e.code==429 and a<3: time.sleep(65); continue
            raise
def pt(w):
    if not w.startswith("Point("):return None
    try: lng,lat=w[6:-1].split(); return float(lat),float(lng)
    except: return None
recs=[];seen=set()
for i,c in enumerate(CATS):
    if i>0: time.sleep(65)
    try: d=q(c)
    except Exception as e: print(c['label'],"失敗",e,flush=True);continue
    n=0
    for b in d["results"]["bindings"]:
        nm=b.get("itemLabel",{}).get("value","")
        if not nm or (nm[0]=="Q" and nm[1:].isdigit()): continue
        ll=pt(b.get("coord",{}).get("value",""))
        if not ll: continue
        pref=b.get("prefLabel",{}).get("value","")
        if pref[:1]=="Q" and pref[1:].isdigit(): pref=""
        if b["item"]["value"] in seen: continue
        seen.add(b["item"]["value"])
        recs.append({"name":nm.strip()[:120],"address":pref or "日本","area":pref or None,"lat":ll[0],"lng":ll[1],"tags":c["tags"],"source":"wikidata"})
        n+=1
    print(c['label'],n,"件",flush=True)
json.dump(recs,open("/tmp/wikidata3_records.json","w"),ensure_ascii=False)
print("=== 合計",len(recs),"件 ===",flush=True)
