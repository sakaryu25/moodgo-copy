// ─── MoodGo 共通タグ定義 ────────────────────────────────────────────────────
// 管理者・ユーザー投稿のタグ入力はすべてここのリストから選択
// recommend API ではこれを使って気分マッチング・スコアリングを行う
//
// ★ タグは必ず # プレフィックス付きで保存・比較すること
// ★ AI生成タグは必ず ALL_PREDEFINED_TAGS の中からのみ選択
// ★ 自由形式のタグ（絵文字付き短文など）は廃止済み

export type TagCategory = {
  label: string;
  key: string;
  tags: string[];
};

export const TAG_CATEGORIES: TagCategory[] = [
  {
    label: "同伴者（誰と行く？）",
    key: "companion",
    tags: ["#一人OK", "#友達向け", "#恋人・デート向け", "#家族・子連れOK", "#大人数グループOK", "#先輩・接待向け"],
  },
  {
    label: "予算帯",
    key: "budget",
    tags: ["#予算_低", "#予算_中", "#予算_高"],
  },
  {
    label: "規模感",
    key: "scale",
    tags: ["#手軽・サクッと", "#大規模施設", "#広大な自然", "#近場の公園", "#整備された公園"],
  },
  {
    label: "気分（必須：最低1つ選択）",
    key: "mood",
    tags: [
      "#お腹すいた",
      "#まったりしたい",
      "#わいわい楽しみたい",
      "#自然感じたい",
      "#ドライブしたい",
      "#集中したい",
      "#体を動かしたい",
      "#遠くに行きたい",
    ],
  },
  {
    // 全投稿に自動付与する共通タグ（バックエンドと整合）。
    label: "共通タグ（全投稿に自動付与）",
    key: "common",
    tags: ["#穴場スポット", "#時間潰し"],
  },
  {
    label: "景観・環境",
    key: "scenery",
    tags: ["#自然の中", "#海_川_湖_水辺", "#山_森_緑", "#季節の花々", "#街一望_パノラマ", "#360度_木々", "#都市_都会", "#観光地_名所"],
  },
  {
    label: "施設の種類・空間",
    key: "facility",
    tags: ["#カフェ", "#温泉スパ", "#室内施設", "#屋外施設"],
  },
  {
    label: "くつろぐ設備・姿勢",
    key: "relax",
    tags: ["#ソファ_ベンチあり", "#足を伸ばせる", "#寝っ転がれる", "#景色を見ながら歩ける"],
  },
  {
    label: "集中するための設備",
    key: "focus",
    tags: ["#WiFiあり", "#電源あり", "#静かな机あり", "#飲み物あり"],
  },
  {
    label: "音環境",
    key: "noise",
    tags: ["#無音に近い", "#適度なざわつき", "#多少賑やか", "#BGMあり"],
  },
  {
    label: "雰囲気",
    key: "atmosphere",
    tags: ["#おしゃれ", "#賑やか", "#静か", "#密室_個室", "#穴場"],
  },
  {
    label: "過ごし方・目的",
    key: "activity",
    tags: ["#景色を眺める", "#カフェでまったり", "#散歩・街歩き", "#休息", "#非日常", "#絶景", "#ショッピング", "#異文化"],
  },
  {
    label: "遊び・エンタメ",
    key: "entertainment",
    tags: ["#ゲーム_勝負系", "#見る_体験系", "#ものづくり_創作"],
  },
  {
    label: "作業・集中",
    key: "work",
    tags: ["#勉強_受験向き", "#PC作業_リモートワーク向き", "#読書向き", "#創作_趣味向き"],
  },
  {
    label: "運動・スポーツ",
    key: "sports",
    tags: [
      "#ガッツリ汗をかく", "#ほどよく動く", "#軽く散歩", "#外に出るだけ",
      "#スポーツ_競技", "#ランニング_ウォーキング", "#アウトドア_ハイキング", "#水泳_プール",
    ],
  },
  {
    label: "空腹度・飲食ペース",
    key: "food",
    tags: ["#軽食", "#サクッと食べる", "#座ってゆっくり", "#ドカ食い_食べ放題"],
  },
  {
    label: "味の好み",
    key: "taste",
    tags: ["#ジャンク", "#あっさり", "#辛いもの", "#甘いもの"],
  },
  {
    label: "料理ジャンル",
    key: "foodGenre",
    tags: ["#ご飯もの_お米", "#麺類", "#洋食", "#韓国", "#中華"],
  },
];

// 気分タグとMoodGoの気分キーのマッピング
export const MOOD_TAG_MAP: Record<string, string> = {
  "#お腹すいた":         "お腹すいた",
  "#まったりしたい":     "まったりしたい",
  "#わいわい楽しみたい": "わいわい楽しみたい",
  "#自然感じたい":       "自然感じたい",
  "#ドライブしたい":     "ドライブしたい",
  "#集中したい":         "集中したい",
  "#体を動かしたい":     "体を動かしたい",
  "#遠くに行きたい":     "遠くに行きたい",
  "#時間潰し":           "時間潰し",
};

export const MOOD_TAGS = TAG_CATEGORIES.find((c) => c.key === "mood")!.tags;
export const ALL_PREDEFINED_TAGS = TAG_CATEGORIES.flatMap((c) => c.tags);

// ─── 施設タグ付け用システムプロンプト ───────────────────────────────────────
export function buildFacilityTaggingPrompt(tagList: string[]): string {
  return `あなたは施設・スポット情報のタグ付け専門AIです。

【絶対ルール — 違反厳禁】
1. 必ず以下の【定義済みタグリスト】の中からのみタグを選択すること
2. リストに存在しないタグは絶対に作成・出力しないこと（ハルシネーション厳禁）
3. 確信が持てない情報にもとづくタグは付けないこと（精度を最優先）
4. 出力は必ず JSON 形式 { "tags": ["#タグ1", "#タグ2", ...] } のみ
5. 1スポットあたり2〜15個のタグを付与すること

【定義済みタグリスト】（このリスト以外は絶対使用禁止）
${tagList.join(", ")}

【タグ選択の指針】
- スポット名・説明文・施設タイプから確実に読み取れる特徴のみタグ化する
- 飲食店なら味・ジャンル・雰囲気タグ、公園なら規模・景観タグを重点的に
- 「#気分タグ」は特に重要。そのスポットが向いている気分を必ず1つ以上付ける
- 同伴者タグ（#一人OK, #恋人・デート向け など）も必ず判断して付ける
- 曖昧な情報から推測して付けるのは禁止（例：駐車場の記載なしに#駐車 は不可）`;
}

// ─── ユーザー検索タグ抽出用システムプロンプト ───────────────────────────────
export function buildUserTagExtractionPrompt(tagList: string[]): string {
  return `あなたはユーザーの気分・状況からスポット検索タグを選別するAIです。

【絶対ルール — 違反厳禁】
1. 必ず以下の【定義済みタグリスト】の中からのみタグを選択すること
2. リストに存在しないタグは絶対に作成しないこと
3. 出力は必ず JSON 形式のみ

【定義済みタグリスト】
${tagList.join(", ")}

【出力形式】
{
  "mustTags": ["必須タグ（これを持つスポットを優先検索）"],
  "niceToHaveTags": ["加点タグ（あると嬉しい・スコアアップ）"],
  "excludeTags": ["除外タグ（これを持つスポットは除外）"]
}

【選別ルール】
- mustTags: ユーザーの気分・目的に直結するタグ（気分タグは必ず含める）
- niceToHaveTags: ユーザーの回答から読み取れる付加条件
- excludeTags: ユーザーの回答と明らかに相反するタグ（例：静かさを求めているなら#賑やか）
- 推測・拡大解釈は禁止。ユーザーが明示した条件のみをタグ化する`;
}

// ─── ユーザー回答からタグをルールベースで抽出 ───────────────────────────────
// AI を使わず決定論的にタグを生成する（高速・無料・ハルシネーションなし）
type DynamicQAnswer = { question: string; answer: string };

export function extractUserTagsFromAnswers(answers: {
  mood?: string;
  companion?: string;
  budget?: number;
  budgetMin?: number;
  atmosphere?: string;
  dynamicQs?: DynamicQAnswer[];
  dynamicQ1?: DynamicQAnswer | string;
  dynamicQ2?: DynamicQAnswer | string;
  dynamicQ3?: DynamicQAnswer | string;
  dynamicQ4?: DynamicQAnswer | string;
}): { mustTags: string[]; niceToHaveTags: string[]; excludeTags: string[] } {
  const mustTags: string[] = [];
  const niceToHaveTags: string[] = [];
  const excludeTags: string[] = [];

  // ── 気分タグ（必須）
  if (answers.mood) {
    const moodTag = Object.entries(MOOD_TAG_MAP).find(([, v]) => v === answers.mood)?.[0];
    if (moodTag) mustTags.push(moodTag);
  }

  // ── 同伴者タグ
  const companionTagMap: [string, string][] = [
    ["一人",           "#一人OK"],
    ["友達",           "#友達向け"],
    ["恋人",           "#恋人・デート向け"],
    ["家族",           "#家族・子連れOK"],
    ["大人数",         "#大人数グループOK"],
    ["先輩",           "#先輩・接待向け"],
  ];
  if (answers.companion) {
    for (const [key, tag] of companionTagMap) {
      if (answers.companion.includes(key)) { addUniq(niceToHaveTags, tag); break; }
    }
  }

  // ── 予算タグ
  if (answers.budget !== undefined) {
    if (answers.budget === 0 || (answers.budget <= 1500 && (answers.budgetMin ?? 0) === 0)) {
      addUniq(niceToHaveTags, "#予算_低");
    } else if (answers.budget <= 5000) {
      addUniq(niceToHaveTags, "#予算_中");
    } else {
      addUniq(niceToHaveTags, "#予算_高");
    }
  }

  // ── 雰囲気タグ
  const atmosphereTagMap: Record<string, string> = {
    "静か": "#静か", "賑やか": "#賑やか", "おしゃれ": "#おしゃれ", "穴場": "#穴場",
  };
  if (answers.atmosphere && atmosphereTagMap[answers.atmosphere]) {
    addUniq(niceToHaveTags, atmosphereTagMap[answers.atmosphere]);
  }

  // ── 動的質問の回答 → タグマッピング
  const ANSWER_TO_TAGS: Record<string, string[]> = {
    // まったりしたい
    "自然の中🌿":            ["#自然の中", "#屋外施設"],
    "カフェ☕":               ["#カフェ", "#室内施設"],
    "温泉・スパ♨️":          ["#温泉スパ"],
    "絶景スポット🌅":         ["#絶景", "#景色を眺める"],
    "ソファでのんびり🛋️":    ["#ソファ_ベンチあり"],
    "足を伸ばしたい🦵":       ["#足を伸ばせる"],
    "寝っ転がりたい💤":       ["#寝っ転がれる"],
    "景色見ながら歩きたい🚶":["#景色を見ながら歩ける", "#散歩・街歩き"],
    "山や森🌲":              ["#山_森_緑"],
    "海辺🌊":                ["#海_川_湖_水辺"],
    "こだわらない！":         [],

    // 集中したい
    "wifi・電源🔌":          ["#WiFiあり", "#電源あり"],
    "静かな机🪑":            ["#静かな机あり"],
    "飲み物☕":              ["#飲み物あり"],
    "無音に近い方が良い🔇":  ["#無音に近い"],
    "適度なざわつき🔉":      ["#適度なざわつき"],
    "多少賑やかでも大丈夫🔊":["#多少賑やか"],
    "BGM程なら🎵":          ["#BGMあり"],
    "勉強・受験📖":          ["#勉強_受験向き"],
    "PC作業・リモートワーク💻":["#PC作業_リモートワーク向き"],
    "読書📚":                ["#読書向き"],
    "創作・趣味✏️":          ["#創作_趣味向き"],

    // 体を動かしたい
    "ガッツリ汗をかきたい💪": ["#ガッツリ汗をかく"],
    "ほどよく動きたい🏃":    ["#ほどよく動く"],
    "軽く散歩程度🚶":        ["#軽く散歩"],
    "外に出るだけでOK🌞":   ["#外に出るだけ"],
    "スポーツ・競技🏀":      ["#スポーツ_競技"],
    "ランニング・ウォーキング🏃":["#ランニング_ウォーキング"],
    "アウトドア・ハイキング🏔":["#アウトドア_ハイキング"],
    "水泳・プール🏊":        ["#水泳_プール"],
    "室内施設・ジム🏋️":     ["#室内施設"],
    "広い公園・グラウンド⚽": ["#屋外施設"],
    "山・自然の中🌲":        ["#山_森_緑", "#自然の中"],
    "海・川・湖🌊":          ["#海_川_湖_水辺"],

    // わいわい楽しみたい
    "ゲーム・勝負系🎮":      ["#ゲーム_勝負系"],
    "見る・体験系👀":        ["#見る_体験系"],
    "ものづくり・創作🎨":    ["#ものづくり_創作"],
    "街を散歩🗺️":           ["#散歩・街歩き"],
    "大きな施設で🏰":        ["#大規模施設"],
    "手軽にサクッと⚡":      ["#手軽・サクッと"],

    // お腹すいた
    "軽く食べたい🌱":        ["#軽食"],
    "ほどほど😊":            [],
    "ぺこぺこ😋":            [],
    "ドカ食いしたい🤤":      ["#ドカ食い_食べ放題"],
    "ジャンク🍟":            ["#ジャンク"],
    "あっさり🍵":            ["#あっさり"],
    "辛いもの🌶️":           ["#辛いもの"],
    "甘いもの🍰":            ["#甘いもの"],
    "ご飯もの🍚":            ["#ご飯もの_お米"],
    "麺類🍜":                ["#麺類"],
    "洋食🍝":                ["#洋食"],
    "韓国🌶️":               ["#韓国"],
    "中華🥟":                ["#中華"],
    "スイーツ🍰":            ["#甘いもの"],
    "サクッと食べる⚡":      ["#サクッと食べる"],
    "座ってゆっくり🪑":      ["#座ってゆっくり"],
    "食べ放題🍽️":           ["#ドカ食い_食べ放題"],
    "賑やか🎉":              ["#賑やか"],
    "静か✨":                ["#静か"],
    "おしゃれ💅":            ["#おしゃれ"],
    "密室🔒":                ["#密室_個室"],
    "自然の中で食事🌿":      ["#自然の中", "#屋外施設"],
    "海辺で食事🌊":          ["#海_川_湖_水辺"],

    // 自然感じたい（体を動かしたいと重複する項目はここでは新規キーのみ定義）
    "景色を眺める👀":        ["#景色を眺める"],
    "カフェでまったり☕":    ["#カフェでまったり"],
    "自然の中を散歩🚶":      ["#散歩・街歩き", "#自然の中"],
    "近場の公園🌳":          ["#近場の公園"],
    "整備された綺麗な公園🌸":["#整備された公園"],
    "広大な自然や絶景🏔":    ["#広大な自然", "#絶景"],
    "季節の花々🌸":          ["#季節の花々"],
    "街一望🏙️":             ["#街一望_パノラマ"],
    "360°木々🌲":           ["#360度_木々"],
    "海辺🏖️":               ["#海_川_湖_水辺"],

    // 遠くに行きたい
    "自然・山・海🌊":        ["#自然の中", "#広大な自然"],
    "観光地・名所⛩️":        ["#観光地_名所"],
    "温泉・リゾート♨️":     ["#温泉スパ"],
    "都市・異文化🌆":        ["#都市_都会", "#異文化"],
    "非日常を味わいたい✨":  ["#非日常"],
    "絶景を見たい🌅":        ["#絶景"],
    "楽しみたい🎉":          [],
    "ゆっくり過ごしたい😴":  ["#休息"],

    // ドライブしたい
    "絶景🌅":                ["#絶景"],
    "休憩☕":                ["#休息", "#カフェでまったり"],
    "遊べる🎡":              ["#見る_体験系"],
    "穴場🗺️":               ["#穴場"],
    "海沿い🌊":              ["#海_川_湖_水辺"],
    "山⛰️":                  ["#山_森_緑"],
    "都会🌃":                ["#都市_都会"],
    "食事🍽️":               ["#お腹すいた"],
    "景色🌅":                ["#景色を眺める", "#絶景"],
    "体験・アクティビティ🎡":["#見る_体験系"],
    "ショッピング🛍️":        ["#ショッピング"],
    "散歩🚶":                ["#散歩・街歩き"],
    "休息💤":                ["#休息"],
  };

  // dynamicQs (新形式) または dynamicQ1-4 (旧形式) から回答を取得
  const allDynAnswers: string[] = [];
  if (answers.dynamicQs && answers.dynamicQs.length > 0) {
    answers.dynamicQs.forEach(dq => allDynAnswers.push(dq.answer));
  } else {
    for (const dq of [answers.dynamicQ1, answers.dynamicQ2, answers.dynamicQ3, answers.dynamicQ4]) {
      if (!dq) continue;
      const ans = typeof dq === "string" ? dq : dq.answer;
      if (ans) allDynAnswers.push(ans);
    }
  }

  for (const ans of allDynAnswers) {
    const tags = ANSWER_TO_TAGS[ans];
    if (tags) {
      for (const tag of tags) addUniq(niceToHaveTags, tag);
    }
  }

  // mustTags と重複する niceToHaveTags を除去
  const finalNice = niceToHaveTags.filter(t => !mustTags.includes(t));

  return { mustTags, niceToHaveTags: finalNice, excludeTags };
}

function addUniq(arr: string[], item: string) {
  if (!arr.includes(item)) arr.push(item);
}
