# データ取り込みパイプライン（Supabase places 蓄積）

オープンデータ/CC系の「名前＋住所/座標」リストを Supabase `places` に投入し、
気分検索の Supabase-first ヒット率を上げて Google searchText 課金を削減するための ETL。
ghostmap（心霊6,969件）と同じ仕組み。**商用OKなライセンスのソースのみ**を使うこと。

## 使い方
環境変数 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`（`.env.local`）を読み込んで実行。

```
# 1) 取得（ソース別にレコードJSONを作る）
python3 fetch_wikidata.py        # 温泉/滝/海岸/湿原/山/遊園地/展望/世界遺産 → /tmp/wikidata_records.json
python3 fetch_wikidata3.py       # 道の駅?/動物園/水族館/博物館 → /tmp/wikidata3_records.json
python3 build_ndl.py             # NDL公共図書館CSV → /tmp/ndl_records.json
python3 build_michinoeki.py      # Wikipedia道の駅一覧 → /tmp/michinoeki_records.json

# 2) 投入（汎用インポーター。同県dedup・タグマージ・GSI無料ジオコーディング・uniform keys batch）
python3 import_records.py /tmp/ndl_records.json ndl
```

## レコード形式
`{name, address?, lat?, lng?, tags:[...], area?, source}`
- 座標があれば（Wikidata）ジオコーディング不要。無ければ住所を国土地理院(GSI)で無料ジオコーディング。
- `source_type` を付けるので、admin「登録済みスポット検索・削除」で `source:wikidata` 等で一括管理/削除できる。

## 注意・落とし穴
- **Wikidata**: 障害時は 429（1req/分）。65秒間隔＋リトライが要る。座標は P625（Point(lng lat)）。
- **PostgREST バッチ insert は全行同一キー必須** → lat/lng/nearest_station は常にキーを持たせる（null可）。
- **places.address は NOT NULL** → 住所空は area/県名でフォールバック。
- **geocache** `/tmp/geocache.json` は複数importerの同時書き込みで壊れうる → ジオコーディングするimporterは直列実行。
- **ライセンス**: Wikidata=CC0 / Wikipedia=CC-BY-SA(出典+継承) / OSM=ODbL(出典) / 政府=政府標準利用規約・PDL1.0(データ毎に商用可否確認)。
  食べログ等の商用ToSサイトは使わない。国土数値情報 P12観光資源/一部P35は非商用なので除外。
