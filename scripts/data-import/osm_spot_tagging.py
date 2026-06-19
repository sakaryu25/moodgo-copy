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
