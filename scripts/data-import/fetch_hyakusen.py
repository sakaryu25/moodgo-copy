import urllib.request, urllib.parse, re, html, json
def get(u):
    return urllib.request.urlopen(urllib.request.Request('https://ja.wikipedia.org/wiki/'+urllib.parse.quote(u),headers={'User-Agent':'MoodGo/1.0'}),timeout=30).read().decode('utf-8','replace')
def clean(c): return html.unescape(re.sub(r'<[^>]+>',' ',c)).strip()
PAGES=[
 {"p":"名水百選","tags":["#自然感じたい","#名水","#まったりしたい"],"furigana":False},
 {"p":"平成の名水百選","tags":["#自然感じたい","#名水","#まったりしたい"],"furigana":False},
 {"p":"日本の世界遺産","tags":["#遠くに行きたい","#世界遺産"],"furigana":True},
]
recs=[]; seen=set()
for pg in PAGES:
    try: t=get(pg["p"])
    except Exception as e: print(pg["p"],"失敗",e); continue
    n=0
    for tbl in re.findall(r'<table[^>]*?wikitable[^>]*>(.*?)</table>', t, re.S):
        rows=re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S)
        if not rows: continue
        hdr=[clean(c) for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', rows[0], re.S)]
        def find(keys):
            for i,h in enumerate(hdr):
                if any(k in h for k in keys): return i
            return -1
        ni=find(["名称","登録名","名前","湿地名"]); li=find(["所在地","都道府県","所在"])
        if ni<0 or li<0: continue
        for row in rows[1:]:
            cells=[clean(c) for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)]
            if len(cells)<=max(ni,li): continue
            name=cells[ni]; loc=re.sub(r'\s+','',cells[li])
            if pg["furigana"]:
                name=re.sub(r'^[ぁ-ゟ\s]+','',name).strip()  # 先頭ふりがな除去
            name=re.sub(r'[（(].*?[）)]','',name).strip()
            if not name or len(name)<2: continue
            key=name+"|"+loc[:6]
            if key in seen: continue
            seen.add(key)
            recs.append({"name":name[:120],"address":loc or "日本","area":None,"tags":pg["tags"],"source":"wikipedia-hyakusen"})
            n+=1
    print(pg["p"],n,"件")
json.dump(recs,open("/tmp/hyakusen_records.json","w"),ensure_ascii=False)
print("=== 合計",len(recs),"件 ===")
