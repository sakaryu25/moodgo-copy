import urllib.request, urllib.parse, json, csv, io, time
def j(u): return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'MoodGo/1.0'}),timeout=40).read())
def dl(u):
    raw=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'MoodGo/1.0'}),timeout=40).read()
    for enc in ('utf-8-sig','cp932','utf-8'):
        try: return raw.decode(enc)
        except: pass
    return None
DS_CAP=2500; REC_CAP=20000
# 1) CKANでCSV URLを集める
urls=[]; start=0
while len(urls)<DS_CAP:
    d=j('https://data.bodik.jp/api/3/action/package_search?q='+urllib.parse.quote('観光施設一覧')+f'&rows=200&start={start}')
    rows=d['result']['results']
    if not rows: break
    for r in rows:
        for res in r.get('resources',[]):
            if res.get('format','').upper()=='CSV':
                urls.append(res['url']); break
    start+=200
    if start>=d['result']['count']: break
print('CSV URL収集:',len(urls),flush=True)
# 2) 各CSVをパース（標準カラム: 名称/住所/緯度/経度/都道府県名）
recs=[]; seen=set(); ok=0; ng=0
for i,u in enumerate(urls[:DS_CAP]):
    if len(recs)>=REC_CAP: break
    try:
        t=dl(u)
        if not t: ng+=1; continue
        rd=csv.DictReader(io.StringIO(t))
        for row in rd:
            name=(row.get('名称') or '').strip()
            lat=(row.get('緯度') or '').strip(); lng=(row.get('経度') or '').strip()
            if not name: continue
            pref=(row.get('都道府県名') or '').strip(); addr=(row.get('住所') or '').strip() or pref or '日本'
            try: la=float(lat); ln=float(lng)
            except: la=ln=None
            if la is None: continue  # 座標なしはスキップ(geocode負荷回避)
            if not (24<la<46 and 122<ln<154): continue
            key=name+'|'+f'{round(la,3)},{round(ln,3)}'
            if key in seen: continue
            seen.add(key)
            recs.append({'name':name[:120],'address':addr,'area':pref or None,'lat':la,'lng':ln,
                         'tags':['#遠くに行きたい','#観光'],'source':'jichitai-od'})
            if len(recs)>=REC_CAP: break
        ok+=1
    except Exception: ng+=1
    if i%200==0: print(f'  {i}/{len(urls)} データセット処理, レコード{len(recs)}',flush=True)
json.dump(recs,open('/tmp/kanko_records.json','w'),ensure_ascii=False)
print(f'=== 観光施設 {len(recs)}件（CSV成功{ok}/失敗{ng}・座標つきのみ） ===',flush=True)
