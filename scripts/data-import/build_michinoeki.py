import urllib.request, urllib.parse, re, html, json
PREFS=["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]
STEM={ (p if p=="北海道" else p[:-1]): p for p in PREFS }
PAGES=["道の駅一覧 北海道地方","道の駅一覧 東北地方","道の駅一覧 関東地方","道の駅一覧 中部地方","道の駅一覧 近畿地方","道の駅一覧 中国地方","道の駅一覧 四国地方","道の駅一覧 九州地方","道の駅一覧 沖縄県"]
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'MoodGo/1.0'}),timeout=30).read().decode('utf-8','replace')
def clean(c): return html.unescape(re.sub(r'<[^>]+>',' ',c)).strip()
recs=[]; seen=set()
for page in PAGES:
    try: t=get('https://ja.wikipedia.org/wiki/'+urllib.parse.quote(page))
    except Exception as e: print(page,'取得失敗',e); continue
    n=0
    for tbl in re.findall(r'<table[^>]*?wikitable[^>]*>(.*?)</table>', t, re.S):
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.S):
            cells=re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)
            if len(cells)<4: continue
            ekimei=clean(cells[0]); shozai=clean(cells[1]); no=clean(cells[3])
            if not ekimei or ekimei.startswith('駅名'): continue
            ekimei=re.sub(r'[（(].*?[）)]','',ekimei).strip()  # ふりがな除去
            m=re.match(r'([^\-－]+)[\-－]', no)
            pref=STEM.get(m.group(1).strip(),'') if m else ''
            if not pref:
                pref=next((p for p in PREFS if p in shozai or (p[:-1] in shozai)),'')
            name='道の駅'+ekimei
            key=pref+'|'+ekimei
            if not ekimei or key in seen: continue
            seen.add(key)
            addr=(pref+re.sub(r'\s+','',shozai)) or pref or '日本'
            recs.append({"name":name[:120],"address":addr,"area":pref or None,
                         "tags":["#ドライブしたい","#道の駅","#まったりしたい"],"source":"michi-no-eki"})
            n+=1
    print(page,n,'件'); 
import time
json.dump(recs,open('/tmp/michinoeki_records.json','w'),ensure_ascii=False)
print('=== 道の駅合計',len(recs),'件 ===')
