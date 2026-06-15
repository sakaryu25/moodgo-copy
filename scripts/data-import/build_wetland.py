import urllib.request, urllib.parse, re, html, json
R2P={'hokkaido':'北海道','aomori':'青森県','iwate':'岩手県','miyagi':'宮城県','akita':'秋田県','yamagata':'山形県','fukushima':'福島県','ibaraki':'茨城県','tochigi':'栃木県','gunma':'群馬県','saitama':'埼玉県','chiba':'千葉県','tokyo':'東京都','kanagawa':'神奈川県','niigata':'新潟県','toyama':'富山県','ishikawa':'石川県','fukui':'福井県','yamanashi':'山梨県','nagano':'長野県','gifu':'岐阜県','shizuoka':'静岡県','aichi':'愛知県','mie':'三重県','shiga':'滋賀県','kyoto':'京都府','osaka':'大阪府','hyogo':'兵庫県','nara':'奈良県','wakayama':'和歌山県','tottori':'鳥取県','shimane':'島根県','okayama':'岡山県','hiroshima':'広島県','yamaguchi':'山口県','tokushima':'徳島県','kagawa':'香川県','ehime':'愛媛県','kochi':'高知県','fukuoka':'福岡県','saga':'佐賀県','nagasaki':'長崎県','kumamoto':'熊本県','oita':'大分県','miyazaki':'宮崎県','kagoshima':'鹿児島県','okinawa':'沖縄県'}
base='https://www.env.go.jp/nature/important_wetland/'
def get(u): return urllib.request.urlopen(urllib.request.Request(base+u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30).read().decode('utf-8','replace')
def clean(c): return html.unescape(re.sub(r'<[^>]+>',' ',c)).strip()
idx=get('senteichi_ichiran.html')
subs=sorted(set(re.findall(r'(wetland/p\d+[^\"]*\.html)', idx)))
recs=[]; seen=set()
for s in subs:
    pref=next((R2P[r] for r in R2P if r in s),'')
    try: t=get(s)
    except Exception as e: print(s,'失敗',e); continue
    m=re.search(r'<table[^>]*>(.*?)</table>',t,re.S)
    if not m: continue
    n=0
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>',m.group(1),re.S):
        cells=[clean(c) for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>',row,re.S)]
        if len(cells)<3 or cells[0]=='番号': continue
        city=cells[1]; name=cells[2]
        city=re.split(r'[，,・]',city)[0].strip()  # 複数市町村は先頭
        if not name or len(name)<2: continue
        key=pref+'|'+name
        if key in seen: continue
        seen.add(key)
        recs.append({'name':name[:120],'address':(pref+city) or pref or '日本','area':pref or None,
                     'tags':['#自然感じたい','#湿原','#遠くに行きたい'],'source':'env-wetland'})
        n+=1
    print(pref,n,'件')
json.dump(recs,open('/tmp/wetland_records.json','w'),ensure_ascii=False)
print('=== 重要湿地 合計',len(recs),'件 ===')
