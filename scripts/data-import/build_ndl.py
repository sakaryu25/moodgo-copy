import csv, json
recs=[]
with open('/tmp/ndl_public.csv', newline='') as f:
    r=csv.DictReader(f)
    for row in r:
        name=(row.get('機関名Institution name in Japanese') or '').strip()
        if not name: continue
        pref=(row.get('都道府県Prefecture') or '').strip()
        city=(row.get('市区町村City/Ward/Town/Village') or '').strip()
        street=(row.get('町名番地Address') or '').strip()
        addr=(pref+city+street).strip() or pref or '日本'
        recs.append({"name":name[:120],"address":addr,"area":pref or None,
                     "tags":["#集中したい","#図書館","#まったりしたい"],"source":"ndl"})
json.dump(recs,open('/tmp/ndl_records.json','w'),ensure_ascii=False)
print("NDL公共図書館 レコード:",len(recs))
print("サンプル:",recs[0]['name'],"|",recs[0]['address'])
