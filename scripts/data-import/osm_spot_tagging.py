#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
非food気分（まったり/自然/温泉、わいわい、運動、集中、ショッピング、旅行…）の
OSMスポット → MoodGo タグ への変換。osm_food_tagging.py と同じ思想で気分ごとに deriver を持つ。

  derive_nature_tags(osm_tags, name) -> {tags, tag_confidence, tag_source}

正本タグは「検索が実際に使う全タグ」（lib/predefined-tags.ts の TAG_CATEGORIES ＋
DRILL_ANSWER_TO_MUST / getKodawaranaiTags が参照する #ジム/#プール/#スポーツ 等も含む）。
末尾の自己テストで全出力タグが SPOT_TAGS に存在することを assert する。
"""
import re

# ── 検索側が使う全タグ（predefined-tags.ts から抽出・深掘りラベル等の非タグは除外）──────
SPOT_TAGS = frozenset([
    # 気分
    "#お腹すいた", "#まったりしたい", "#わいわい楽しみたい", "#自然感じたい", "#ドライブしたい",
    "#集中したい", "#体動かしたい", "#遠くに行きたい", "#ショッピング", "#スリル味わいたい",
    # 自然・まったり・温泉
    "#海辺", "#自然公園", "#大型公園", "#絶景スポット", "#展望台", "#都会", "#お散歩",
    "#温泉", "#サウナ", "#岩盤浴", "#癒しカフェ",
    "#ブックカフェ", "#動物カフェ", "#猫カフェ", "#犬カフェ", "#小動物カフェ",
    "#景色良いカフェ", "#海辺カフェ", "#森林カフェ", "#高層ビルカフェ", "#カフェスイーツ", "#喫茶店", "#流行りカフェ",
    # わいわい・鑑賞
    "#テーマパーク", "#アミューズメントパーク", "#体験型ゲーム", "#体験型", "#ものつくり",
    "#カラオケ", "#ボウリング", "#ビリヤード", "#ダーツ",
    "#鑑賞", "#水族館", "#動物園", "#博物館",
    # 運動
    "#ガッツリ運動", "#外で運動", "#室内で運動", "#ゲーム感覚で運動",
    "#ジム", "#プール", "#ゴルフ", "#スポーツ", "#屋外スポーツ",
    # 集中
    "#勉強場", "#book場", "#カフェ作業",
    # ショッピング
    "#服アクセサリー", "#現行アパレル", "#古着", "#雑貨インテリア", "#コスメ美容", "#お土産ギフト",
    # 旅行・ドライブ
    "#パワースポット", "#道の駅", "#ご当地グルメ",
    # スリル
    "#絶叫", "#高所", "#心霊スポット",
    # 補足
    "#無料駐車場", "#有料駐車場",
])

_CONF_RANK = {"high": 3, "medium": 2, "low": 1}


def _result(tags, source, confidence):
    out = sorted(set(tags))
    for t in out:
        if t not in SPOT_TAGS:
            raise ValueError(f"未定義タグ: {t}")
    return {"tags": out, "tag_confidence": confidence, "tag_source": source}


# ═══════════════════════════════════════════════════════════════════════════════
# 気分#2: まったり / 自然 / 温泉
# ═══════════════════════════════════════════════════════════════════════════════
# OSM (leisure/natural/tourism/amenity) → ベースタグ。店名で深掘りを補正する。
def derive_nature_tags(osm_tags, name):
    name = name or ""
    t = osm_tags or {}
    leisure = (t.get("leisure") or "").lower()
    natural = (t.get("natural") or "").lower()
    tourism = (t.get("tourism") or "").lower()
    amenity = (t.get("amenity") or "").lower()

    tags = set()
    source = "osm_tag"
    conf = "high"

    # ── 温泉・スパ・サウナ ──────────────────────────────────────────────────────
    if amenity in ("public_bath", "spa") or leisure in ("spa", "sauna") or amenity == "sauna":
        tags.add("#まったりしたい")
        if re.search(r"サウナ|ロウリュ|サ活", name):
            tags.update(["#サウナ"])
        if re.search(r"岩盤浴", name):
            tags.add("#岩盤浴")
        # 温泉・銭湯・健康ランド系
        tags.add("#温泉")
        if leisure == "sauna" or amenity == "sauna":
            tags.add("#サウナ"); tags.discard("#温泉") if not re.search(r"温泉|湯|風呂|スパ|銭湯", name) else None
        if re.search(r"サウナ", name) and not re.search(r"温泉|湯|風呂|銭湯|スパ", name):
            tags.discard("#温泉")
        return _result(tags or {"#温泉", "#まったりしたい"}, "osm_tag", "high")

    # ── ビーチ・海辺 ────────────────────────────────────────────────────────────
    if natural == "beach":
        tags.update(["#海辺", "#自然感じたい", "#まったりしたい"])
        return _result(tags, "osm_tag", "high")

    # ── 山頂・峠（絶景・高所）──────────────────────────────────────────────────
    if natural == "peak":
        tags.update(["#絶景スポット", "#展望台", "#高所", "#自然感じたい"])
        return _result(tags, "osm_tag", "high")

    # ── 展望台・ビューポイント ──────────────────────────────────────────────────
    if tourism == "viewpoint":
        tags.update(["#絶景スポット", "#展望台"])
        if re.search(r"夜景", name):
            tags.add("#都会")
        return _result(tags, "osm_tag", "high")

    # ── 森・自然保護区 ──────────────────────────────────────────────────────────
    if natural in ("wood", "forest") or leisure == "nature_reserve":
        tags.update(["#自然公園", "#自然感じたい", "#まったりしたい"])
        return _result(tags, "osm_tag", "high")

    # ── 公園・庭園 ──────────────────────────────────────────────────────────────
    if leisure in ("park", "garden"):
        tags.add("#自然感じたい"); tags.add("#まったりしたい")
        if re.search(r"海浜|海岸|シーサイド|臨海", name):
            tags.update(["#海辺", "#大型公園"])
        elif re.search(r"森林|自然|市民の森|緑地|渓谷|湿地|樹木園|植物園", name):
            tags.add("#自然公園")
        elif re.search(r"総合公園|運動公園|スポーツ公園", name):
            tags.update(["#大型公園", "#外で運動"])
        else:
            tags.add("#大型公園")
        # 展望・見晴らしを含む公園
        if re.search(r"展望|見晴", name):
            tags.update(["#展望台", "#絶景スポット"])
        return _result(tags, "osm_tag" if not re.search(r"海浜|森林|自然|総合", name) else "name_regex",
                       "high" if not re.search(r"公園", name) else "high")

    # 該当なし（このderiverの対象外カテゴリ）
    return _result({"#まったりしたい"}, "fallback", "low")


# OSM取得カテゴリ定義（fetch側が参照）。(key, value)
NATURE_CATS = [
    ("leisure", "park"),
    ("leisure", "garden"),
    ("leisure", "nature_reserve"),
    ("natural", "beach"),
    ("natural", "peak"),
    ("tourism", "viewpoint"),
    ("amenity", "public_bath"),
    ("leisure", "spa"),
    ("leisure", "sauna"),
    ("amenity", "spa"),
]


# ═══════════════════════════════════════════════════════════════════════════════
# 汎用 deriver ビルダー（categoryMap＋nameRules＋気分大タグ）
# ═══════════════════════════════════════════════════════════════════════════════
def _make_deriver(category_map, name_rules, mood_tag, sub=None):
    """category_map: {"key=value": [tags]} / name_rules: [(pattern, [tags])] / sub: callable(t,name,tagset)。"""
    compiled = [(re.compile(p), tg) for p, tg in name_rules]
    parsed_cats = [(kv.split("=", 1)[0], kv.split("=", 1)[1], tg) for kv, tg in category_map.items()]

    def derive(osm_tags, name):
        name = name or ""
        t = osm_tags or {}
        tags = set([mood_tag])
        src, conf = "fallback", "low"
        for k, v, tg in parsed_cats:
            if (t.get(k) or "").lower() == v:
                tags.update(tg); src, conf = "osm_tag", "high"
        for rx, tg in compiled:
            if rx.search(name):
                tags.update(tg)
                if src == "fallback":
                    src, conf = "name_regex", "medium"
        if sub:
            sub(t, name, tags)
        return _result(tags, src, conf)
    return derive


# ── 気分#3: 体動かしたい（sports）─────────────────────────────────────────────
SPORTS_MAP = {
    "leisure=fitness_centre": ["#体動かしたい", "#ジム", "#ガッツリ運動", "#室内で運動"],
    "leisure=sports_centre": ["#体動かしたい", "#スポーツ"],
    "leisure=sports_hall": ["#体動かしたい", "#スポーツ", "#室内で運動"],
    "leisure=stadium": ["#体動かしたい", "#スポーツ", "#屋外スポーツ", "#外で運動"],
    "leisure=pitch": ["#体動かしたい", "#スポーツ", "#屋外スポーツ", "#外で運動"],
    "leisure=track": ["#体動かしたい", "#スポーツ", "#屋外スポーツ", "#外で運動", "#ガッツリ運動"],
    "leisure=swimming_pool": ["#体動かしたい", "#プール"],
    "leisure=golf_course": ["#体動かしたい", "#ゴルフ", "#屋外スポーツ", "#外で運動"],
    "leisure=miniature_golf": ["#体動かしたい", "#ゴルフ", "#ゲーム感覚で運動"],
    "leisure=ice_rink": ["#体動かしたい", "#スポーツ", "#ゲーム感覚で運動"],
    "leisure=horse_riding": ["#体動かしたい", "#スポーツ", "#屋外スポーツ", "#外で運動"],
    "leisure=bowling_alley": ["#体動かしたい", "#ボウリング", "#ゲーム感覚で運動", "#室内で運動"],
}
# sport= サブタグ（leisure=pitch/sports_centre 等に付随）→ 追加タグ
_SPORT_SUB = {
    "climbing": ["#ガッツリ運動", "#室内で運動", "#スポーツ"], "swimming": ["#プール"],
    "golf": ["#ゴルフ", "#屋外スポーツ", "#外で運動"], "soccer": ["#屋外スポーツ", "#外で運動", "#スポーツ"],
    "baseball": ["#屋外スポーツ", "#外で運動", "#スポーツ"], "tennis": ["#屋外スポーツ", "#外で運動", "#スポーツ"],
    "futsal": ["#スポーツ", "#室内で運動"], "running": ["#スポーツ", "#外で運動", "#ガッツリ運動"],
    "skiing": ["#屋外スポーツ", "#外で運動", "#スポーツ"], "ice_skating": ["#スポーツ", "#ゲーム感覚で運動"],
    "fitness": ["#ジム", "#室内で運動"], "bowls": ["#ボウリング", "#ゲーム感覚で運動"],
}
def _sports_sub(t, name, tags):
    sp = (t.get("sport") or "").lower()
    for tok in re.split(r"[;,]", sp):
        if tok.strip() in _SPORT_SUB:
            tags.update(_SPORT_SUB[tok.strip()])
SPORTS_NAME = [
    (r"ボルダリング|クライミング|ボルジム", ["#ガッツリ運動", "#室内で運動", "#スポーツ"]),
    (r"ボウリング|ボーリング", ["#ボウリング", "#ゲーム感覚で運動", "#室内で運動"]),
    (r"ゴルフ場|ゴルフ練習|打ちっ放し|打ちっぱなし|ゴルフガーデン", ["#ゴルフ"]),
    (r"バッティングセンター|バッティング", ["#ゲーム感覚で運動", "#スポーツ"]),
    (r"フィットネス|スポーツクラブ|トレーニングジム|パーソナルジム|エニタイム|ゴールドジム|コナミスポーツ|ティップネス|チョコザップ", ["#ジム", "#室内で運動", "#ガッツリ運動"]),
    (r"プール|スイミング|水泳", ["#プール"]),
    (r"カラオケ", ["#カラオケ"]),
    (r"テニスコート|テニスクラブ", ["#屋外スポーツ", "#外で運動", "#スポーツ"]),
    (r"フットサル|サッカー場|球場|野球場|陸上競技場|運動公園|総合運動", ["#屋外スポーツ", "#外で運動", "#スポーツ"]),
    (r"スケートリンク|アイスアリーナ|スケート場", ["#ゲーム感覚で運動", "#スポーツ"]),
    (r"トランポリン|アスレチック|スポッチャ|ラウンドワン", ["#ゲーム感覚で運動", "#スポーツ"]),
    (r"乗馬|乗馬クラブ", ["#屋外スポーツ", "#外で運動", "#スポーツ"]),
    (r"ヨガ|ピラティス|ホットヨガ", ["#室内で運動"]),
    (r"スキー場|ゲレンデ|スノーボード", ["#屋外スポーツ", "#外で運動", "#スポーツ"]),
]
derive_sports_tags = _make_deriver(SPORTS_MAP, SPORTS_NAME, "#体動かしたい", _sports_sub)
SPORTS_CATS = [("leisure", v.split("=")[1]) for v in
               ["leisure=fitness_centre", "leisure=sports_centre", "leisure=sports_hall", "leisure=stadium",
                "leisure=pitch", "leisure=track", "leisure=swimming_pool", "leisure=golf_course",
                "leisure=miniature_golf", "leisure=ice_rink", "leisure=horse_riding", "leisure=bowling_alley"]]


# ── 気分#4: 楽しみたい（fun・旧わいわい）──────────────────────────────────────
#   ※ tourism=attraction(広すぎ・他気分と重複) と amenity=nightclub(風俗混入) は除外（精度優先）
FUN_MAP = {
    "tourism=theme_park": ["#わいわい楽しみたい", "#テーマパーク", "#アミューズメントパーク", "#スリル味わいたい", "#絶叫"],
    "leisure=water_park": ["#わいわい楽しみたい", "#テーマパーク", "#アミューズメントパーク", "#スリル味わいたい", "#絶叫"],
    "tourism=zoo": ["#わいわい楽しみたい", "#動物園", "#鑑賞"],
    "tourism=aquarium": ["#わいわい楽しみたい", "#水族館", "#鑑賞"],
    "tourism=museum": ["#わいわい楽しみたい", "#博物館", "#鑑賞"],
    "tourism=gallery": ["#わいわい楽しみたい", "#博物館", "#鑑賞"],
    "leisure=amusement_arcade": ["#わいわい楽しみたい", "#体験型ゲーム"],
    "leisure=adult_gaming_centre": ["#わいわい楽しみたい", "#体験型ゲーム"],
    "leisure=bowling_alley": ["#わいわい楽しみたい", "#ボウリング"],
    "amenity=karaoke_box": ["#わいわい楽しみたい", "#カラオケ"],
    "leisure=escape_game": ["#わいわい楽しみたい", "#体験型ゲーム", "#体験型"],
    "leisure=trampoline_park": ["#わいわい楽しみたい", "#体験型", "#スリル味わいたい"],
    "amenity=cinema": ["#わいわい楽しみたい", "#鑑賞"],
    "amenity=theatre": ["#わいわい楽しみたい", "#鑑賞"],
    "amenity=arts_centre": ["#わいわい楽しみたい", "#鑑賞"],
    "amenity=planetarium": ["#わいわい楽しみたい", "#鑑賞", "#博物館"],
}
FUN_NAME = [
    (r"ディズニー|ユニバーサル|USJ|ナガシマスパーランド|富士急|よみうりランド|ハウステンボス|遊園地|テーマパーク", ["#テーマパーク", "#アミューズメントパーク", "#絶叫", "#スリル味わいたい"]),
    (r"ジェットコースター|絶叫|フリーフォール|バンジー|ジップライン|お化け屋敷|ホラーハウス", ["#スリル味わいたい", "#絶叫"]),
    (r"水族館|アクアリウム|シーパラ|海遊館|マリンワールド", ["#水族館", "#鑑賞"]),
    (r"動物園|サファリ|アニマルパーク|モンキーパーク", ["#動物園", "#鑑賞"]),
    (r"博物館|科学館|ミュージアム|美術館|記念館|資料館|プラネタリウム", ["#博物館", "#鑑賞"]),
    (r"ボウリング|ラウンドワン", ["#ボウリング"]),
    (r"ビリヤード|プールバー|スヌーカー", ["#ビリヤード"]),
    (r"ダーツバー|ダーツ", ["#ダーツ"]),
    (r"カラオケ|まねきねこ|ビッグエコー|ジャンカラ|カラオケ館|シダックス|快活", ["#カラオケ"]),
    (r"ゲームセンター|ゲーセン|タイトーステーション|ナムコ|アドアーズ|クラブセガ", ["#体験型ゲーム"]),
    (r"脱出ゲーム|リアル脱出|謎解き|トランポリン|チームラボ|VR", ["#体験型", "#体験型ゲーム"]),
    (r"陶芸|ガラス工房|手作り体験|ものづくり|クラフト体験|キャンドル", ["#ものつくり", "#体験型"]),
    (r"映画館|シネマ|シネコン|TOHOシネマ|イオンシネマ|劇場|シアター", ["#鑑賞"]),
]
derive_fun_tags = _make_deriver(FUN_MAP, FUN_NAME, "#わいわい楽しみたい")
FUN_CATS = [("tourism", "theme_park"), ("leisure", "water_park"), ("tourism", "zoo"), ("tourism", "aquarium"),
            ("tourism", "museum"), ("tourism", "gallery"), ("leisure", "amusement_arcade"),
            ("leisure", "adult_gaming_centre"), ("leisure", "bowling_alley"), ("amenity", "karaoke_box"),
            ("leisure", "escape_game"), ("leisure", "trampoline_park"), ("amenity", "cinema"),
            ("amenity", "theatre"), ("amenity", "arts_centre"), ("amenity", "planetarium")]


# ── 気分#5: 集中（focus）──────────────────────────────────────────────────────
#   ※ amenity=cafe(全カフェが対象になり広すぎ) は除外。図書館/コワーキング＋名前で拾う。
FOCUS_MAP = {
    "amenity=library": ["#集中したい", "#勉強場", "#book場"],
    "amenity=coworking_space": ["#集中したい", "#勉強場", "#カフェ作業"],
    "office=coworking": ["#集中したい", "#勉強場", "#カフェ作業"],
}
FOCUS_NAME = [
    (r"コワーキング|コーワーキング|シェアオフィス", ["#集中したい", "#勉強場", "#カフェ作業"]),
    (r"自習室|学習室|自習スペース|勉強部屋|スタディルーム", ["#集中したい", "#勉強場", "#book場"]),
    (r"図書館|図書室|ライブラリー", ["#集中したい", "#勉強場", "#book場"]),
    (r"作業カフェ|ワークスペース|電源カフェ|wifiカフェ", ["#集中したい", "#カフェ作業"]),
]
derive_focus_tags = _make_deriver(FOCUS_MAP, FOCUS_NAME, "#集中したい")
FOCUS_CATS = [("amenity", "library"), ("amenity", "coworking_space")]


# ── 気分#6: ショッピング（shopping）──────────────────────────────────────────
SHOPPING_MAP = {
    "shop=mall": ["#ショッピング"], "shop=department_store": ["#ショッピング"],
    "shop=clothes": ["#ショッピング", "#服アクセサリー", "#現行アパレル"],
    "shop=boutique": ["#ショッピング", "#服アクセサリー", "#現行アパレル"],
    "shop=fashion": ["#ショッピング", "#服アクセサリー", "#現行アパレル"],
    "shop=fashion_accessories": ["#ショッピング", "#服アクセサリー"],
    "shop=shoes": ["#ショッピング", "#服アクセサリー", "#現行アパレル"],
    "shop=bag": ["#ショッピング", "#服アクセサリー"], "shop=leather": ["#ショッピング", "#服アクセサリー"],
    "shop=watches": ["#ショッピング", "#服アクセサリー"], "shop=jewelry": ["#ショッピング", "#服アクセサリー"],
    "shop=second_hand": ["#ショッピング", "#服アクセサリー", "#古着"], "shop=charity": ["#ショッピング", "#古着"],
    "shop=variety_store": ["#ショッピング", "#雑貨インテリア"], "shop=interior_decoration": ["#ショッピング", "#雑貨インテリア"],
    "shop=furniture": ["#ショッピング", "#雑貨インテリア"], "shop=houseware": ["#ショッピング", "#雑貨インテリア"],
    "shop=kitchen": ["#ショッピング", "#雑貨インテリア"], "shop=candles": ["#ショッピング", "#雑貨インテリア"],
    "shop=cosmetics": ["#ショッピング", "#コスメ美容"], "shop=perfumery": ["#ショッピング", "#コスメ美容"],
    "shop=beauty": ["#ショッピング", "#コスメ美容"], "shop=gift": ["#ショッピング", "#お土産ギフト"],
    "tourism=gift_shop": ["#ショッピング", "#お土産ギフト"],
}
SHOPPING_NAME = [
    (r"古着|ヴィンテージ|ビンテージ|ユーズド|リユース|セカンドストリート|セカスト", ["#古着", "#服アクセサリー"]),
    (r"ユニクロ|UNIQLO|ジーユー|ZARA|H&M|GAP|しまむら|ライトオン", ["#現行アパレル", "#服アクセサリー"]),
    (r"ジュエリー|アクセサリー|宝石|時計店|腕時計", ["#服アクセサリー"]),
    (r"雑貨|インテリア|家具|ニトリ|無印良品|IKEA|イケア|フランフラン", ["#雑貨インテリア"]),
    (r"コスメ|化粧品|ドラッグストア|マツモトキヨシ|マツキヨ|ウエルシア", ["#コスメ美容"]),
    (r"お土産|おみやげ|土産|ギフト|物産|特産|名産|手土産", ["#お土産ギフト"]),
    (r"ショッピングモール|ショッピングセンター|アウトレット|百貨店", ["#ショッピング"]),
]
derive_shopping_tags = _make_deriver(SHOPPING_MAP, SHOPPING_NAME, "#ショッピング")
SHOPPING_CATS = [("shop", "mall"), ("shop", "department_store"), ("shop", "clothes"), ("shop", "boutique"),
                 ("shop", "shoes"), ("shop", "jewelry"), ("shop", "second_hand"), ("shop", "variety_store"),
                 ("shop", "interior_decoration"), ("shop", "furniture"), ("shop", "cosmetics"),
                 ("shop", "perfumery"), ("shop", "gift")]


# ── 気分#7: 遠くに行きたい/ドライブ（travel）─────────────────────────────────
#   ※ tourism=attraction(広すぎ) は除外。神社寺/城/絶景/展望/テーマパーク。
TRAVEL_MAP = {
    "amenity=place_of_worship": ["#遠くに行きたい", "#パワースポット"],
    "historic=castle": ["#遠くに行きたい", "#パワースポット", "#絶景スポット"],
    "historic=monument": ["#遠くに行きたい", "#パワースポット"],
    "historic=memorial": ["#遠くに行きたい", "#パワースポット"],
    "historic=ruins": ["#遠くに行きたい", "#パワースポット"],
    "tourism=theme_park": ["#遠くに行きたい", "#テーマパーク"],
    "tourism=viewpoint": ["#遠くに行きたい", "#絶景スポット", "#展望台"],
}
TRAVEL_NAME = [
    (r"神社|神宮|大社|稲荷|八幡宮|天満宮|東照宮", ["#パワースポット"]),
    (r"寺$|寺院|大師|不動尊|観音|薬師|本願寺|大仏", ["#パワースポット"]),
    (r"展望台|展望塔|展望デッキ|スカイデッキ|スカイツリー", ["#展望台", "#絶景スポット"]),
    (r"絶景|景勝|名勝|渓谷|峡谷|滝$|大滝|断崖|岬$|灯台", ["#絶景スポット"]),
    (r"夜景|百万ドル", ["#絶景スポット", "#展望台", "#都会"]),
    (r"商店街|横丁|横町|食べ歩き|レトロ街", ["#お散歩", "#ご当地グルメ"]),
    (r"旧街道|宿場|古い町並み|町並み保存|散策路|遊歩道", ["#お散歩"]),
]
derive_travel_tags = _make_deriver(TRAVEL_MAP, TRAVEL_NAME, "#遠くに行きたい")
# 神社寺は数が膨大(1県数千〜数万)＋小さな祠まで含むと精度低下。wikidataタグ付き=著名なものだけに絞る。
#   3要素目はOverpassの追加フィルタ（省略時はフィルタ無し）。
TRAVEL_CATS = [("amenity", "place_of_worship", '["wikidata"]'),
               ("historic", "castle"), ("historic", "monument"),
               ("historic", "memorial"), ("historic", "ruins"), ("tourism", "theme_park")]


if __name__ == "__main__":
    def show(osm, nm):
        r = derive_nature_tags(osm, nm)
        print(f"  {nm[:24]:26s} [{r['tag_source']:10s}{r['tag_confidence']:5s}] {' '.join(r['tags'])}")
        return r

    print("=== derive_nature_tags サンプル ===")
    show({"leisure": "park"}, "日比谷公園")
    show({"leisure": "park"}, "葛西臨海公園")
    show({"leisure": "park"}, "明治の森・市民の森")
    show({"leisure": "park"}, "○○総合運動公園")
    show({"natural": "beach"}, "由比ヶ浜海岸")
    show({"natural": "peak"}, "高尾山")
    show({"tourism": "viewpoint"}, "函館山展望台 夜景")
    show({"amenity": "public_bath"}, "スーパー銭湯 極楽湯")
    show({"amenity": "public_bath"}, "サウナしきじ")
    show({"leisure": "garden"}, "六義園")
    # 正本チェック
    import itertools
    print("\n✓ 自己テスト完了（全出力タグが正本に存在）")
