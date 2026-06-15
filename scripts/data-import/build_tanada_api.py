import urllib.request, urllib.parse, json, re
PREFS=set(["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"])
u='https://ja.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&page='+urllib.parse.quote('日本の棚田百選')
wt=json.loads(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'MoodGo/1.0'}),timeout=30).read())['parse']['wikitext']
recs=[]; cur=''; seen=set()
for line in wt.splitlines():
    s=line.strip()
    m1=re.match(r'^\*\s*\[\[([^\]|]+?)\]\]\s*$', s)
    if m1 and m1.group(1) in PREFS: cur=m1.group(1); continue
    if s.startswith('**') and cur:
        c=s[2:].strip()
        lm=re.search(r'\[\[([^\]]+?)\]\]', c)
        name=(lm.group(1).split('|')[0] if lm else re.split(r'[（(]',c)[0]).strip()
        name=re.sub(r'\[\[|\]\]','',name).split('|')[0].strip()
        pm=re.search(r'[（(](.+?)[）)]', c); loc=''
        if pm:
            raw=re.sub(r'\[\[([^\]|]*\|)?','',pm.group(1)).replace(']]','')
            cm=re.search(r'([^\s,，、 ]+?[市町村区])', raw); loc=cm.group(1) if cm else ''
        if not name or len(name)<1: continue
        # 名前が「○○」だけで棚田語が無ければ補う
        disp=name if ('棚田' in name or '千枚田' in name) else name+'の棚田'
        key=cur+'|'+disp
        if key in seen: continue
        seen.add(key)
        recs.append({'name':disp[:120],'address':(cur+loc) or cur or '日本','area':cur,
                     'tags':['#自然感じたい','#棚田','#遠くに行きたい'],'source':'wikipedia-tanada'})
json.dump(recs,open('/tmp/tanada_records.json','w'),ensure_ascii=False)
print('棚田百選:',len(recs),'件')
for r in recs[:6]: print('  ',r['name'],'|',r['address'])
