#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OSM 飲食データ → MoodGo 定義済みタグ への変換（フェーズ1: 飲食ジャンル）。

derive_food_tags(osm_tags: dict, name: str) -> dict
  返り値: {
    "tags": ["#お腹すいた", "#ラーメン", ...],   # 必ず ALL_PREDEFINED_TAGS の実在タグのみ
    "tag_confidence": "high" | "medium" | "low",
    "tag_source": "chain_dictionary" | "cuisine" | "name_regex" | "amenity" | "fallback",
  }

判定優先順位（高信頼→低信頼）:
  1. チェーン店辞書 CHAINS        … 店名に確定チェーンが含まれる (high)
  2. cuisine タグ CUISINE_MAP     … OSM標準の cuisine= (high)
  3. 店名正規表現 NAME_RULES      … 日本のOSMは大半が cuisine 未設定のため実効カバレッジの要 (medium)
  4. amenity フォールバック        … pub/bar→#居酒屋, cafe→#カフェスイーツ (medium) / fast_food (low)
  5. 最終フォールバック             … ジャンル不明な飲食店は #お腹すいた のみ (low)

タグは union（複数手段が当たれば和集合）。tag_source/tag_confidence は寄与した中で最も高信頼な手段を採用。
全タグは lib/predefined-tags.ts の ALL_PREDEFINED_TAGS に実在するものに限定（末尾の自己テストで assert）。
"""

import re

# ── 検索側が実際に使う正本タグ（lib/predefined-tags.ts の ALL_PREDEFINED_TAGS）─────
#    ※ tags: [...] 配列から機械抽出した 126 件。ここに無いタグは絶対に返さない。
PREDEFINED_TAGS = frozenset([
    "#10000〜", "#10代", "#1人", "#20代以上", "#book場", "#〜10000", "#〜3000", "#〜5000",
    "#あっさりラーメン", "#うどんそば", "#おすすめ", "#お土産ギフト", "#お好み焼きもんじゃ", "#お散歩",
    "#お腹すいた", "#こってりラーメン", "#ご当地グルメ", "#つけ麺まぜそば", "#まったりしたい", "#ものつくり",
    "#わいわい楽しみたい", "#アジアンエスタニック料理", "#アジア系統", "#イタリアン", "#インドネパール料理",
    "#オムライス", "#カフェスイーツ", "#カフェ作業", "#カラオケ", "#ガッツリ運動", "#ゲーム感覚で運動",
    "#コスメ美容", "#サウナ", "#ショッピング", "#ステーキ", "#スリル味わいたい", "#タイ料理", "#ダーツ",
    "#テーマパーク", "#ドライブしたい", "#ハンバーグ", "#パワースポット", "#ビリヤード", "#ファミレス",
    "#フルーツ", "#ブックカフェ", "#ブラジル料理", "#ベトナム料理", "#ボウリング", "#メキシコ料理",
    "#ラーメン", "#レトロ洋食", "#ロシア料理", "#中華", "#交通手段全般", "#他国料理", "#体動かしたい",
    "#体験型", "#体験型ゲーム", "#先輩", "#勉強場", "#動物カフェ", "#友達", "#古着", "#各国料理",
    "#味噌ラーメン", "#和食", "#喫茶店", "#外で運動", "#大人数", "#大型公園", "#大衆酒場", "#天ぷら",
    "#女性", "#室内で運動", "#家族", "#小動物カフェ", "#居酒屋", "#居酒屋個室", "#展望台", "#岩盤浴",
    "#徒歩", "#心霊スポット", "#恋人", "#懐石料理", "#景色良いカフェ", "#有料駐車場", "#服アクセサリー",
    "#期間限定", "#未定", "#森林カフェ", "#洋食", "#流行りカフェ", "#海辺", "#海辺カフェ", "#海鮮",
    "#温泉", "#無料", "#無料駐車場", "#焼肉", "#焼肉単品", "#焼肉食べ放題", "#犬カフェ", "#猫カフェ",
    "#現行アパレル", "#男女", "#男性", "#癒しカフェ", "#絶叫", "#絶景スポット", "#自然公園", "#自然感じたい",
    "#自転車", "#車バイク", "#道の駅", "#遠くに行きたい", "#都会", "#鑑賞", "#集中したい", "#雑貨インテリア",
    "#電車バス", "#韓国", "#高層ビルカフェ", "#高層ビル料理", "#高所", "#高級焼肉",
])

BASE = "#お腹すいた"

# ── 1. チェーン店辞書（最優先・confidence=high）──────────────────────────────────
#    店名に key（部分一致）が含まれたら value のタグを付与。店名だけでジャンルが確定する主要チェーン。
CHAINS = {
    # ラーメン
    "一蘭": ["#ラーメン", "#こってりラーメン"],
    "天下一品": ["#ラーメン", "#こってりラーメン"],
    "ラーメン二郎": ["#ラーメン", "#こってりラーメン"],
    "町田商店": ["#ラーメン", "#こってりラーメン"],
    "横浜家系": ["#ラーメン", "#こってりラーメン"],
    "日高屋": ["#ラーメン"],
    "幸楽苑": ["#ラーメン"],
    "餃子の王将": ["#中華"],
    "大阪王将": ["#中華"],
    "バーミヤン": ["#中華"],
    # うどん・そば
    "丸亀製麺": ["#和食", "#うどんそば"],
    "はなまるうどん": ["#和食", "#うどんそば"],
    "なか卯": ["#和食", "#うどんそば"],
    "富士そば": ["#和食", "#うどんそば"],
    "ゆで太郎": ["#和食", "#うどんそば"],
    # 寿司・海鮮
    "スシロー": ["#和食", "#海鮮"],
    "くら寿司": ["#和食", "#海鮮"],
    "はま寿司": ["#和食", "#海鮮"],
    "かっぱ寿司": ["#和食", "#海鮮"],
    "魚べい": ["#和食", "#海鮮"],
    "銚子丸": ["#和食", "#海鮮"],
    # 焼肉
    "牛角": ["#焼肉"],
    "焼肉きんぐ": ["#焼肉", "#焼肉食べ放題"],
    "安楽亭": ["#焼肉"],
    "叙々苑": ["#焼肉", "#高級焼肉"],
    # 居酒屋
    "鳥貴族": ["#居酒屋"],
    "磯丸水産": ["#居酒屋", "#海鮮"],
    "ワタミ": ["#居酒屋"],
    "和民": ["#居酒屋"],
    "白木屋": ["#居酒屋"],
    "魚民": ["#居酒屋", "#海鮮"],
    "笑笑": ["#居酒屋"],
    "塚田農場": ["#居酒屋"],
    # カフェ
    "スターバックス": ["#カフェスイーツ", "#喫茶店"],
    "スタバ": ["#カフェスイーツ", "#喫茶店"],
    "ドトール": ["#カフェスイーツ", "#喫茶店"],
    "タリーズ": ["#カフェスイーツ", "#喫茶店"],
    "珈琲館": ["#カフェスイーツ", "#喫茶店"],
    "コメダ珈琲": ["#カフェスイーツ", "#喫茶店"],
    "星乃珈琲": ["#カフェスイーツ", "#喫茶店"],
    "サンマルクカフェ": ["#カフェスイーツ", "#喫茶店"],
    "上島珈琲": ["#カフェスイーツ", "#喫茶店"],
    "エクセルシオール": ["#カフェスイーツ", "#喫茶店"],
    # イタリアン
    "サイゼリヤ": ["#イタリアン", "#洋食"],
    "ピザーラ": ["#イタリアン"],
    "ドミノ・ピザ": ["#イタリアン"],
    "ピザハット": ["#イタリアン"],
    "カプリチョーザ": ["#イタリアン"],
    # ファミレス・洋食
    "ガスト": ["#洋食", "#ファミレス"],
    "デニーズ": ["#洋食", "#ファミレス"],
    "ジョナサン": ["#洋食", "#ファミレス"],
    "ロイヤルホスト": ["#洋食", "#ファミレス"],
    "ココス": ["#洋食", "#ファミレス"],
    "びっくりドンキー": ["#洋食", "#ハンバーグ"],
    "ステーキガスト": ["#洋食", "#ステーキ"],
    "いきなりステーキ": ["#洋食", "#ステーキ"],
    "ブロンコビリー": ["#洋食", "#ステーキ"],
    # 韓国・アジア
    "韓国": ["#韓国"],  # ざっくり（名前に韓国が入る店）
    # 牛丼・和食チェーン
    "吉野家": ["#和食"],
    "すき家": ["#和食"],
    "松屋": ["#和食"],
    "やよい軒": ["#和食"],
    "大戸屋": ["#和食"],
    "ガスト ": ["#洋食", "#ファミレス"],
}

# ── 2. cuisine タグ → 定義済みタグ（confidence=high）──────────────────────────────
#    OSM cuisine= の値（小文字, ; 区切り）を 1 トークンずつ照合。
CUISINE_MAP = {
    "ramen": ["#ラーメン"],
    "sushi": ["#和食", "#海鮮"],
    "japanese": ["#和食"],
    "udon": ["#和食", "#うどんそば"],
    "soba": ["#和食", "#うどんそば"],
    "tempura": ["#和食", "#天ぷら"],
    "donburi": ["#和食"],
    "kaiseki": ["#和食", "#懐石料理"],
    "yakiniku": ["#焼肉"],
    "korean_bbq": ["#焼肉"],
    "yakitori": ["#居酒屋"],
    "izakaya": ["#居酒屋"],
    "korean": ["#韓国"],
    "italian": ["#イタリアン"],
    "pizza": ["#イタリアン"],
    "pasta": ["#イタリアン"],
    "chinese": ["#中華"],
    "thai": ["#アジア系統", "#タイ料理"],
    "indian": ["#アジア系統", "#インドネパール料理"],
    "nepalese": ["#アジア系統", "#インドネパール料理"],
    "vietnamese": ["#アジア系統", "#ベトナム料理"],
    "indonesian": ["#アジア系統", "#アジアンエスタニック料理"],
    "asian": ["#アジア系統"],
    "mexican": ["#各国料理", "#メキシコ料理"],
    "brazilian": ["#各国料理", "#ブラジル料理"],
    "russian": ["#各国料理", "#ロシア料理"],
    "spanish": ["#各国料理", "#他国料理"],
    "american": ["#洋食"],
    "burger": ["#洋食", "#ハンバーグ"],
    "steak_house": ["#洋食", "#ステーキ"],
    "steak": ["#洋食", "#ステーキ"],
    "western": ["#洋食"],
    "french": ["#洋食"],
    "okonomiyaki": ["#お好み焼きもんじゃ"],
    "cafe": ["#カフェスイーツ", "#喫茶店"],
    "coffee_shop": ["#カフェスイーツ", "#喫茶店"],
    "ice_cream": ["#カフェスイーツ"],
    "cake": ["#カフェスイーツ"],
    "dessert": ["#カフェスイーツ"],
    "sweets": ["#カフェスイーツ"],
    "pancake": ["#カフェスイーツ"],
    "crepe": ["#カフェスイーツ"],
}

# ── 3. 店名正規表現（confidence=medium）— ジャンル＋深掘りを店名から推定 ─────────────
#    上から順に評価し、当たったタグを和集合で積む（複数ヒット可）。
NAME_RULES = [
    # ラーメン（ジャンル＋深掘り）
    (re.compile(r"ラーメン|らーめん|ラー麺|麺屋|中華そば|らあめん"), ["#ラーメン"]),
    (re.compile(r"家系|豚骨|とんこつ|こってり|二郎"), ["#ラーメン", "#こってりラーメン"]),
    (re.compile(r"あっさり|塩ラーメン|淡麗"), ["#ラーメン", "#あっさりラーメン"]),
    (re.compile(r"味噌ラーメン|みそラーメン"), ["#ラーメン", "#味噌ラーメン"]),
    (re.compile(r"つけ麺|まぜそば|油そば|汁なし"), ["#ラーメン", "#つけ麺まぜそば"]),
    # 焼肉
    (re.compile(r"焼肉|焼き肉|ホルモン|ジンギスカン|炭火焼"), ["#焼肉"]),
    (re.compile(r"食べ放題.*焼肉|焼肉.*食べ放題"), ["#焼肉", "#焼肉食べ放題"]),
    (re.compile(r"黒毛和牛|和牛|叙々苑|高級焼肉"), ["#焼肉", "#高級焼肉"]),
    # 和食・海鮮・天ぷら・そば
    (re.compile(r"寿司|鮨|すし|海鮮|魚|浜焼き|刺身|海鮮丼"), ["#和食", "#海鮮"]),
    (re.compile(r"天ぷら|天麩羅|天丼"), ["#和食", "#天ぷら"]),
    (re.compile(r"そば|蕎麦|うどん|饂飩"), ["#和食", "#うどんそば"]),
    (re.compile(r"懐石|割烹|料亭|会席"), ["#和食", "#懐石料理"]),
    (re.compile(r"和食|日本料理|定食|食堂|めし"), ["#和食"]),
    # 居酒屋
    (re.compile(r"居酒屋|酒場|大衆酒場|焼き鳥|焼鳥|やきとり|串焼|串カツ|もつ焼"), ["#居酒屋"]),
    (re.compile(r"個室.*居酒屋|完全個室"), ["#居酒屋", "#居酒屋個室"]),
    (re.compile(r"大衆酒場|大衆居酒屋|横丁|横丁"), ["#居酒屋", "#大衆酒場"]),
    # 洋食
    (re.compile(r"ハンバーグ"), ["#洋食", "#ハンバーグ"]),
    (re.compile(r"オムライス"), ["#洋食", "#オムライス"]),
    (re.compile(r"ステーキ|肉料理"), ["#洋食", "#ステーキ"]),
    (re.compile(r"洋食|グリル|キッチン"), ["#洋食"]),
    # イタリアン
    (re.compile(r"イタリアン|イタリア料理|ピザ|ピッツァ|パスタ|スパゲ|トラットリア|リストランテ"), ["#イタリアン"]),
    # 中華
    (re.compile(r"中華|中国料理|餃子|町中華|四川|台湾料理"), ["#中華"]),
    # 韓国
    (re.compile(r"韓国|サムギョプサル|タッカルビ|スンドゥブ|韓国料理|コリアン"), ["#韓国"]),
    # アジア系統
    (re.compile(r"インド料理|ネパール|インドカレー"), ["#アジア系統", "#インドネパール料理"]),
    (re.compile(r"タイ料理|タイ料理|ガパオ|トムヤム"), ["#アジア系統", "#タイ料理"]),
    (re.compile(r"ベトナム|フォー"), ["#アジア系統", "#ベトナム料理"]),
    (re.compile(r"アジアン|エスニック|アジア料理"), ["#アジア系統", "#アジアンエスタニック料理"]),
    # 各国料理
    (re.compile(r"メキシコ|タコス|タコライス"), ["#各国料理", "#メキシコ料理"]),
    (re.compile(r"ブラジル|シュラスコ"), ["#各国料理", "#ブラジル料理"]),
    (re.compile(r"ロシア料理"), ["#各国料理", "#ロシア料理"]),
    # お好み焼き・もんじゃ
    (re.compile(r"お好み焼き|もんじゃ|鉄板焼"), ["#お好み焼きもんじゃ"]),
    # カフェ・スイーツ
    (re.compile(r"カフェ|cafe|Cafe|CAFE|珈琲|コーヒー|喫茶"), ["#カフェスイーツ", "#喫茶店"]),
    (re.compile(r"喫茶店|純喫茶|レトロ喫茶"), ["#カフェスイーツ", "#喫茶店"]),
    (re.compile(r"パフェ|フルーツ|果物|アサイー"), ["#カフェスイーツ", "#フルーツ"]),
    (re.compile(r"スイーツ|ケーキ|パンケーキ|クレープ|パティスリー|洋菓子|甘味"), ["#カフェスイーツ"]),
]

# ── 4. amenity フォールバック ────────────────────────────────────────────────────
AMENITY_MAP = {
    "pub": (["#居酒屋"], "medium"),
    "bar": (["#居酒屋"], "medium"),
    "biergarten": (["#居酒屋"], "medium"),
    "cafe": (["#カフェスイーツ", "#喫茶店"], "medium"),
    "fast_food": ([], "low"),       # ジャンル不明 → #お腹すいた のみ
    "restaurant": ([], "low"),
}

# 信頼度の強さ（高いほど優先）
_CONF_RANK = {"high": 3, "medium": 2, "low": 1}


def _match_chains(name):
    out = []
    for key, tags in CHAINS.items():
        if key in name:
            out.extend(tags)
    return out


def _match_cuisine(cuisine_raw):
    out = []
    if not cuisine_raw:
        return out
    for tok in re.split(r"[;,]", cuisine_raw.lower()):
        tok = tok.strip()
        if tok in CUISINE_MAP:
            out.extend(CUISINE_MAP[tok])
    return out


def _match_name(name):
    out = []
    for rx, tags in NAME_RULES:
        if rx.search(name):
            out.extend(tags)
    return out


def derive_food_tags(osm_tags, name):
    """OSM の tags(dict) と店名 → {tags, tag_confidence, tag_source}。"""
    name = name or ""
    cuisine_raw = osm_tags.get("cuisine", "") if osm_tags else ""
    amenity = (osm_tags.get("amenity", "") if osm_tags else "").lower()

    tags = set([BASE])
    source = "fallback"
    confidence = "low"

    def consider(new_tags, src, conf):
        nonlocal source, confidence
        if not new_tags:
            return
        tags.update(new_tags)
        if _CONF_RANK[conf] > _CONF_RANK[confidence] or (
            _CONF_RANK[conf] == _CONF_RANK[confidence] and source == "fallback"
        ):
            source, confidence = src, conf

    # 1. チェーン辞書（high）
    consider(_match_chains(name), "chain_dictionary", "high")
    # 2. cuisine（high）
    consider(_match_cuisine(cuisine_raw), "cuisine", "high")
    # 3. 店名正規表現（medium）— 深掘りタグの補完にも効く
    consider(_match_name(name), "name_regex", "medium")
    # 4. amenity フォールバック
    if amenity in AMENITY_MAP:
        amen_tags, amen_conf = AMENITY_MAP[amenity]
        consider(amen_tags, "amenity", amen_conf)

    # source 優先順位の最終調整: chain > cuisine > name_regex > amenity > fallback
    #   （consider は信頼度ベースなので、high が複数あれば先勝ち＝chain優先になるよう順序保証済み）

    out_tags = sorted(tags)
    # 念のため正本チェック（万一の表記揺れを実行時に弾く）
    for t in out_tags:
        if t not in PREDEFINED_TAGS:
            raise ValueError(f"未定義タグを出力しようとしました: {t}")

    return {"tags": out_tags, "tag_confidence": confidence, "tag_source": source}


# ── 自己テスト ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # 1) 全 CHAINS / CUISINE_MAP / NAME_RULES のタグが正本に存在することを assert
    bad = set()
    for tags in CHAINS.values():
        bad |= {t for t in tags if t not in PREDEFINED_TAGS}
    for tags in CUISINE_MAP.values():
        bad |= {t for t in tags if t not in PREDEFINED_TAGS}
    for _, tags in NAME_RULES:
        bad |= {t for t in tags if t not in PREDEFINED_TAGS}
    for tags, _ in AMENITY_MAP.values():
        bad |= {t for t in tags if t not in PREDEFINED_TAGS}
    assert not bad, f"正本に存在しないタグがマッピングに含まれています: {bad}"
    print(f"✓ マッピング内タグはすべて正本({len(PREDEFINED_TAGS)}件)に存在")

    # 2) 代表サンプル
    samples = [
        ({"amenity": "restaurant"}, "一蘭 渋谷店"),
        ({"amenity": "restaurant"}, "天下一品 京都本店"),
        ({"amenity": "restaurant", "cuisine": "udon"}, "丸亀製麺 高松店"),
        ({"amenity": "restaurant"}, "スシロー 港北店"),
        ({"amenity": "restaurant"}, "牛角 新宿東口店"),
        ({"amenity": "restaurant", "cuisine": "italian"}, "サイゼリヤ 横浜西口店"),
        ({"amenity": "restaurant"}, "鳥貴族 池袋店"),
        ({"amenity": "cafe"}, "珈琲館 銀座店"),
        ({"amenity": "cafe"}, "ドトールコーヒー 神保町店"),
        ({"amenity": "restaurant"}, "焼肉きんぐ 厚木店"),
        ({"amenity": "restaurant"}, "ラーメン二郎 三田本店"),
        ({"amenity": "restaurant"}, "磯丸水産 川崎店"),
        # cuisine 主導
        ({"amenity": "restaurant", "cuisine": "ramen"}, "麺屋こころ"),
        ({"amenity": "restaurant", "cuisine": "ramen"}, "味噌の達人"),
        # 店名のみ（cuisine 無し）
        ({"amenity": "restaurant"}, "手打ちそば 玄"),
        ({"amenity": "restaurant"}, "大衆酒場 とりあえず"),
        # ジャンル不明
        ({"amenity": "restaurant"}, "レストラン ひまわり"),
        ({"amenity": "fast_food"}, "○○バーガー"),
    ]
    print("\n--- 代表サンプル ---")
    for osm, nm in samples:
        r = derive_food_tags(osm, nm)
        print(f"{nm:24s} | {r['tag_source']:15s} {r['tag_confidence']:6s} | {' '.join(r['tags'])}")
    print("\n✓ 自己テスト完了")
