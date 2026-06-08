/**
 * featureSampleData.ts
 * 特集タブの「仮」コンテンツ（全国 / 地方 / 各県の有名スポット）
 *
 * - admin から /api/featured で投稿があれば、そのスポットが優先表示され、
 *   この仮データはその下に続けて表示される（マージ）。
 * - 画像は 404 を避けるため、実績のある Unsplash URL プールを使い回す。
 *   （あくまで仮素材。admin 投稿の cover_image_url が入れば差し替わる）
 */

// ── 画像プール（テーマ別・全て表示実績のあるURL）─────────────────────────────
const PIC = {
  zekkei:    "https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?w=800&q=80", // 富士・絶景
  mountain:  "https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&q=80",     // 山・ハイキング
  sea:       "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80",  // 海・ビーチ
  cafe:      "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800&q=80",  // カフェ
  gourmet:   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80",  // グルメ
  city:      "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80",  // 都市・夜景
  history:   "https://images.unsplash.com/photo-1590559899731-a382839e5549?w=800&q=80",  // 寺社・歴史
  shrine:    "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800&q=80",  // 花・紫陽花
  nature:    "https://images.unsplash.com/photo-1598935888738-cd2622bcd437?w=800&q=80",  // 自然・滝
  museum:    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80",  // 屋内・館
  onsen:     "https://images.unsplash.com/photo-1554602079-b3929e21fc3e?w=800&q=80",     // 温泉
  harbor:    "https://images.unsplash.com/photo-1476900164809-ff19b8ae5968?w=800&q=80",  // 港・みなとみらい
  port:      "https://images.unsplash.com/photo-1524413840807-0c3cb6fa808d?w=800&q=80",  // 横浜・街
  fireworks: "https://images.unsplash.com/photo-1498931299472-f7a63a5a1cfa?w=800&q=80",  // 花火・夜
} as const;

export type SampleSpot = { title: string; desc: string; image: string };
export type SampleTab = {
  heroLabel?: string;
  heroTitle: string;
  heroDesc: string;
  heroImage: string;
  subtitle?: string;
  sections: { title: string; cards: SampleSpot[] }[];
};

// 県データを簡潔に書くためのショートハンド型
type Spot3 = [string, string, keyof typeof PIC];
const sec = (title: string, spots: Spot3[]) => ({
  title,
  cards: spots.map(([t, d, k]) => ({ title: t, desc: d, image: PIC[k] })),
});

export const SAMPLE_FEATURE: Record<string, SampleTab> = {
  // ───────────────────────────── 全国 ─────────────────────────────
  全国: {
    heroLabel: "日本の名所",
    heroTitle: "一度は訪れたい\n日本の絶景",
    heroDesc: "北は知床から南は石垣島まで、日本が誇る名所を集めました。",
    heroImage: PIC.zekkei,
    subtitle: "日本全国の有名スポット特集",
    sections: [
      sec("日本を代表する絶景", [
        ["富士山", "日本一の霊峰。世界文化遺産", "zekkei"],
        ["立山黒部アルペンルート", "雪の大谷と雄大な山岳", "mountain"],
        ["白川郷 合掌造り集落", "world heritageの原風景", "history"],
        ["宮島・厳島神社", "海に浮かぶ朱の大鳥居", "shrine"],
      ]),
      sec("定番の人気スポット", [
        ["京都・清水寺", "古都を見渡す舞台", "history"],
        ["沖縄・美ら海水族館", "ジンベエザメに会える", "museum"],
        ["北海道・函館山夜景", "世界三大夜景のひとつ", "city"],
        ["東京・浅草寺", "下町情緒あふれる古刹", "history"],
      ]),
    ],
  },

  // ───────────────────────────── 地方 ─────────────────────────────
  "北海道・東北": {
    heroLabel: "北の名所",
    heroTitle: "雄大な自然と\n食の宝庫へ",
    heroDesc: "広大な大地と新鮮な海の幸。北日本の魅力を満喫。",
    heroImage: PIC.mountain,
    sections: [
      sec("北海道・東北で人気", [
        ["知床五湖", "原生林に映る神秘の湖", "nature"],
        ["奥入瀬渓流", "苔と清流の散策路", "nature"],
        ["小樽運河", "ガス灯が灯るレトロ運河", "harbor"],
        ["蔵王の樹氷", "冬の絶景・スノーモンスター", "mountain"],
      ]),
    ],
  },
  関東: {
    heroLabel: "関東の名所",
    heroTitle: "都心も自然も\n楽しめる関東",
    heroDesc: "話題のスポットから絶景まで、関東の今を楽しもう。",
    heroImage: PIC.city,
    sections: [
      sec("関東で人気", [
        ["東京スカイツリー", "下町のランドマーク", "city"],
        ["鎌倉・鶴岡八幡宮", "古都の風情を歩く", "history"],
        ["日光東照宮", "世界遺産の荘厳な社", "history"],
        ["箱根・芦ノ湖", "富士を望む温泉郷", "onsen"],
      ]),
    ],
  },
  中部: {
    heroLabel: "中部の名所",
    heroTitle: "アルプスと\n富士の麓へ",
    heroDesc: "日本の真ん中で出会う、絶景と歴史の旅。",
    heroImage: PIC.zekkei,
    sections: [
      sec("中部で人気", [
        ["上高地", "梓川と穂高連峰の絶景", "mountain"],
        ["兼六園", "日本三名園のひとつ", "shrine"],
        ["白川郷", "合掌造りの世界遺産", "history"],
        ["熱海温泉", "海辺のレトロ温泉街", "onsen"],
      ]),
    ],
  },
  近畿: {
    heroLabel: "近畿の名所",
    heroTitle: "古都の歴史と\n食の宝庫",
    heroDesc: "京都・大阪・奈良。歴史と文化が息づくエリア。",
    heroImage: PIC.history,
    sections: [
      sec("近畿で人気", [
        ["京都・伏見稲荷大社", "千本鳥居の絶景", "history"],
        ["大阪・道頓堀", "食い倒れの街", "city"],
        ["奈良公園", "鹿と大仏に出会う", "history"],
        ["神戸・北野異人館街", "異国情緒あふれる坂道", "port"],
      ]),
    ],
  },
  中国: {
    heroLabel: "中国地方の名所",
    heroTitle: "瀬戸内の海と\n歴史をめぐる",
    heroDesc: "穏やかな海と豊かな歴史が織りなす旅。",
    heroImage: PIC.sea,
    sections: [
      sec("中国地方で人気", [
        ["宮島・厳島神社", "海上に建つ大鳥居", "shrine"],
        ["鳥取砂丘", "日本最大級の砂の丘", "nature"],
        ["足立美術館", "日本一の庭園美", "museum"],
        ["倉敷美観地区", "白壁の町並み", "history"],
      ]),
    ],
  },
  四国: {
    heroLabel: "四国の名所",
    heroTitle: "絶景と\nお遍路の島",
    heroDesc: "緑豊かな四国で、心を整える旅へ。",
    heroImage: PIC.nature,
    sections: [
      sec("四国で人気", [
        ["道後温泉本館", "日本最古級の名湯", "onsen"],
        ["祖谷のかずら橋", "渓谷に架かる秘境の橋", "nature"],
        ["栗林公園", "回遊式の名庭", "shrine"],
        ["四万十川", "日本最後の清流", "nature"],
      ]),
    ],
  },
  "九州・沖縄": {
    heroLabel: "南国の名所",
    heroTitle: "青い海と温泉の\nパワフルな旅",
    heroDesc: "南国の風と、豊かな自然に包まれよう。",
    heroImage: PIC.sea,
    sections: [
      sec("九州・沖縄で人気", [
        ["別府温泉・地獄めぐり", "湯けむり立ちのぼる名湯", "onsen"],
        ["阿蘇山", "雄大なカルデラの絶景", "mountain"],
        ["美ら海水族館", "ジンベエザメの大水槽", "museum"],
        ["屋久島", "縄文杉と苔の森", "nature"],
      ]),
    ],
  },

  // ───────────────────────────── 都道府県 ─────────────────────────────
  北海道: { heroLabel: "北海道", heroTitle: "大自然と\nグルメの宝島", heroDesc: "雄大な景色と新鮮な味覚。", heroImage: PIC.mountain, sections: [
    sec("北海道の定番", [["函館山夜景","世界三大夜景","city"],["小樽運河","レトロな運河散策","harbor"],["美瑛の丘","パッチワークの丘","nature"],["旭山動物園","行動展示で人気","museum"]]) ] },
  青森: { heroLabel: "青森", heroTitle: "祭りと\n自然の県", heroDesc: "ねぶたと奥入瀬の魅力。", heroImage: PIC.nature, sections: [
    sec("青森の定番", [["奥入瀬渓流","苔と清流の散策路","nature"],["弘前城","桜と城の名所","history"],["十和田湖","神秘のカルデラ湖","nature"],["八甲田山","樹氷と紅葉","mountain"]]) ] },
  岩手: { heroLabel: "岩手", heroTitle: "世界遺産と\n渓谷の県", heroDesc: "平泉と三陸の景観。", heroImage: PIC.history, sections: [
    sec("岩手の定番", [["中尊寺金色堂","世界遺産の輝き","history"],["猊鼻渓","舟下りの渓谷美","nature"],["浄土ヶ浜","白い岩と青い海","sea"],["龍泉洞","日本三大鍾乳洞","nature"]]) ] },
  宮城: { heroLabel: "宮城", heroTitle: "杜の都と\n日本三景", heroDesc: "仙台と松島の魅力。", heroImage: PIC.sea, sections: [
    sec("宮城の定番", [["松島","日本三景の絶景","sea"],["仙台城跡","伊達政宗の城下","history"],["蔵王の御釜","エメラルドの火口湖","mountain"],["秋保大滝","豪快な名瀑","nature"]]) ] },
  秋田: { heroLabel: "秋田", heroTitle: "湖と祭りの\nふるさと", heroDesc: "田沢湖となまはげの里。", heroImage: PIC.nature, sections: [
    sec("秋田の定番", [["田沢湖","日本一深い湖","nature"],["角館武家屋敷","みちのくの小京都","history"],["乳頭温泉郷","秘湯の名湯","onsen"],["なまはげ館","男鹿の伝統文化","museum"]]) ] },
  山形: { heroLabel: "山形", heroTitle: "霊山と\n温泉の県", heroDesc: "山寺と蔵王の絶景。", heroImage: PIC.mountain, sections: [
    sec("山形の定番", [["山寺(立石寺)","断崖の霊場","history"],["銀山温泉","大正ロマンの湯町","onsen"],["蔵王の樹氷","スノーモンスター","mountain"],["最上川舟下り","雄大な川下り","nature"]]) ] },
  福島: { heroLabel: "福島", heroTitle: "歴史と\n湖沼の県", heroDesc: "会津と猪苗代の自然。", heroImage: PIC.nature, sections: [
    sec("福島の定番", [["鶴ヶ城","赤瓦の名城","history"],["五色沼","神秘の沼めぐり","nature"],["大内宿","茅葺き屋根の宿場町","history"],["猪苗代湖","磐梯山を映す湖","nature"]]) ] },

  東京: { heroLabel: "東京", heroTitle: "都市の今を\n楽しむ", heroDesc: "グルメ・夜景・カルチャー。", heroImage: PIC.city, sections: [
    sec("東京の定番", [["浅草・浅草寺","下町情緒の古刹","history"],["東京スカイツリー","634mの展望","city"],["渋谷スクランブル","世界一の交差点","city"],["お台場海浜公園","ベイエリアの夜景","harbor"]]) ] },
  神奈川: { heroLabel: "神奈川", heroTitle: "海と山と\n街並み", heroDesc: "鎌倉・横浜・箱根へ。", heroImage: PIC.port, sections: [
    sec("神奈川の定番", [["鎌倉・鶴岡八幡宮","古都の風情","history"],["横浜みなとみらい","ベイサイドの夜景","harbor"],["箱根・芦ノ湖","富士を望む温泉郷","onsen"],["江の島","湘南の島さんぽ","sea"]]) ] },
  千葉: { heroLabel: "千葉", heroTitle: "海とレジャーの\n県", heroDesc: "東京から近い非日常。", heroImage: PIC.sea, sections: [
    sec("千葉の定番", [["鋸山","地獄のぞきの絶景","mountain"],["犬吠埼","本州最東端の灯台","sea"],["成田山新勝寺","参道グルメも人気","history"],["養老渓谷","紅葉と滝めぐり","nature"]]) ] },
  埼玉: { heroLabel: "埼玉", heroTitle: "小江戸と\n自然", heroDesc: "川越と秩父の魅力。", heroImage: PIC.history, sections: [
    sec("埼玉の定番", [["川越・蔵造りの町並み","小江戸さんぽ","history"],["秩父・羊山公園","芝桜の丘","shrine"],["長瀞ライン下り","渓谷の舟下り","nature"],["三峯神社","山上のパワースポット","history"]]) ] },
  茨城: { heroLabel: "茨城", heroTitle: "花と海の\n県", heroDesc: "ひたち海浜と袋田の滝。", heroImage: PIC.shrine, sections: [
    sec("茨城の定番", [["国営ひたち海浜公園","ネモフィラの青い丘","shrine"],["袋田の滝","四段に流れる名瀑","nature"],["大洗磯前神社","海上の鳥居","shrine"],["牛久大仏","世界最大級の大仏","history"]]) ] },
  栃木: { heroLabel: "栃木", heroTitle: "世界遺産と\n高原", heroDesc: "日光と那須の自然。", heroImage: PIC.history, sections: [
    sec("栃木の定番", [["日光東照宮","荘厳な世界遺産","history"],["華厳の滝","豪快な落差97m","nature"],["那須高原","爽やかなリゾート","mountain"],["あしかがフラワーパーク","大藤のライトアップ","shrine"]]) ] },
  群馬: { heroLabel: "群馬", heroTitle: "温泉王国\n群馬", heroDesc: "草津・伊香保の名湯。", heroImage: PIC.onsen, sections: [
    sec("群馬の定番", [["草津温泉・湯畑","名湯のシンボル","onsen"],["伊香保温泉・石段街","風情ある湯の町","onsen"],["尾瀬ヶ原","水芭蕉の湿原","nature"],["富岡製糸場","世界遺産の近代化遺産","museum"]]) ] },

  新潟: { heroLabel: "新潟", heroTitle: "米と酒と\n離島", heroDesc: "佐渡と越後の自然。", heroImage: PIC.nature, sections: [
    sec("新潟の定番", [["佐渡島","たらい舟と金山","sea"],["清津峡","渓谷トンネルの絶景","nature"],["弥彦神社","越後一宮","history"],["星峠の棚田","雲海と棚田","nature"]]) ] },
  富山: { heroLabel: "富山", heroTitle: "立山と\n富山湾", heroDesc: "雪の大谷と海の幸。", heroImage: PIC.mountain, sections: [
    sec("富山の定番", [["立山黒部アルペンルート","雪の大谷","mountain"],["黒部峡谷トロッコ","渓谷を走る列車","nature"],["雨晴海岸","海越しの立山連峰","sea"],["五箇山合掌造り","世界遺産の集落","history"]]) ] },
  石川: { heroLabel: "石川", heroTitle: "加賀百万石の\n城下町", heroDesc: "金沢と能登の魅力。", heroImage: PIC.shrine, sections: [
    sec("石川の定番", [["兼六園","日本三名園","shrine"],["ひがし茶屋街","風情ある金沢の街","history"],["白米千枚田","海に面した棚田","sea"],["近江町市場","金沢の台所グルメ","gourmet"]]) ] },
  福井: { heroLabel: "福井", heroTitle: "断崖と\n恐竜の県", heroDesc: "東尋坊と永平寺。", heroImage: PIC.sea, sections: [
    sec("福井の定番", [["東尋坊","荒々しい断崖絶壁","sea"],["永平寺","禅の大本山","history"],["恐竜博物館","世界三大恐竜博物館","museum"],["越前海岸","日本海の夕日","sea"]]) ] },
  山梨: { heroLabel: "山梨", heroTitle: "富士山と\nワイン", heroDesc: "河口湖と絶景の県。", heroImage: PIC.zekkei, sections: [
    sec("山梨の定番", [["河口湖","逆さ富士の名所","zekkei"],["新倉山浅間公園","五重塔と富士","history"],["昇仙峡","渓谷美の名勝","nature"],["忍野八海","湧水の里","nature"]]) ] },
  長野: { heroLabel: "長野", heroTitle: "アルプスと\n高原", heroDesc: "上高地と善光寺。", heroImage: PIC.mountain, sections: [
    sec("長野の定番", [["上高地","梓川と穂高の絶景","mountain"],["善光寺","信州の名刹","history"],["地獄谷野猿公苑","温泉に入るサル","onsen"],["軽井沢","高原リゾート","cafe"]]) ] },
  岐阜: { heroLabel: "岐阜", heroTitle: "合掌造りと\n名城", heroDesc: "白川郷と飛騨高山。", heroImage: PIC.history, sections: [
    sec("岐阜の定番", [["白川郷","合掌造りの世界遺産","history"],["飛騨高山・古い町並み","小京都さんぽ","history"],["新穂高ロープウェイ","北アルプスの絶景","mountain"],["郡上八幡","水の城下町","nature"]]) ] },
  静岡: { heroLabel: "静岡", heroTitle: "富士山と\n海の幸", heroDesc: "三保松原と伊豆。", heroImage: PIC.zekkei, sections: [
    sec("静岡の定番", [["三保松原","富士と松原の絶景","zekkei"],["熱海温泉","海辺の温泉街","onsen"],["寸又峡・夢の吊橋","エメラルドの湖上","nature"],["日本平","清水港と富士の展望","city"]]) ] },
  愛知: { heroLabel: "愛知", heroTitle: "名城と\nものづくり", heroDesc: "名古屋の食と文化。", heroImage: PIC.city, sections: [
    sec("愛知の定番", [["名古屋城","金のしゃちほこ","history"],["熱田神宮","由緒ある大社","history"],["トヨタ産業技術記念館","ものづくりの歴史","museum"],["香嵐渓","紅葉の名所","nature"]]) ] },

  三重: { heroLabel: "三重", heroTitle: "お伊勢参りと\n真珠の海", heroDesc: "伊勢神宮と志摩。", heroImage: PIC.history, sections: [
    sec("三重の定番", [["伊勢神宮","日本人の心のふるさと","history"],["夫婦岩","注連縄で結ばれた岩","sea"],["なばなの里","イルミの絶景","city"],["英虞湾","リアス海岸の絶景","sea"]]) ] },
  滋賀: { heroLabel: "滋賀", heroTitle: "琵琶湖と\n古社寺", heroDesc: "湖国の自然と歴史。", heroImage: PIC.nature, sections: [
    sec("滋賀の定番", [["琵琶湖","日本一の湖","nature"],["彦根城","国宝の天守","history"],["メタセコイア並木","絵になる並木道","nature"],["白鬚神社","湖中の大鳥居","shrine"]]) ] },
  京都: { heroLabel: "京都", heroTitle: "千年の都\n京都", heroDesc: "寺社と和の風情。", heroImage: PIC.history, sections: [
    sec("京都の定番", [["清水寺","古都を見渡す舞台","history"],["伏見稲荷大社","千本鳥居","history"],["嵐山・竹林の道","風情ある散策路","nature"],["金閣寺","黄金の楼閣","history"]]) ] },
  大阪: { heroLabel: "大阪", heroTitle: "食い倒れの\n街", heroDesc: "グルメとエンタメ。", heroImage: PIC.city, sections: [
    sec("大阪の定番", [["道頓堀","ネオン輝く繁華街","city"],["大阪城","豊臣秀吉の名城","history"],["新世界・通天閣","レトロな下町","city"],["黒門市場","食の台所","gourmet"]]) ] },
  兵庫: { heroLabel: "兵庫", heroTitle: "名城と\n異国情緒", heroDesc: "姫路と神戸の魅力。", heroImage: PIC.history, sections: [
    sec("兵庫の定番", [["姫路城","白鷺の世界遺産","history"],["神戸・北野異人館","異国情緒の坂道","port"],["有馬温泉","日本三古湯","onsen"],["竹田城跡","天空の城","mountain"]]) ] },
  奈良: { heroLabel: "奈良", heroTitle: "古都と\n大仏", heroDesc: "鹿と歴史の県。", heroImage: PIC.history, sections: [
    sec("奈良の定番", [["東大寺・大仏","世界最大級の青銅仏","history"],["奈良公園","鹿とふれあう","history"],["春日大社","朱塗りの社と灯籠","shrine"],["吉野山","桜の名所","shrine"]]) ] },
  和歌山: { heroLabel: "和歌山", heroTitle: "聖地と\n海の絶景", heroDesc: "高野山と熊野。", heroImage: PIC.nature, sections: [
    sec("和歌山の定番", [["高野山","真言密教の聖地","history"],["熊野古道","世界遺産の参詣道","nature"],["白浜・円月島","夕日の名所","sea"],["那智の滝","落差日本一の名瀑","nature"]]) ] },

  鳥取: { heroLabel: "鳥取", heroTitle: "砂丘と\n名峰", heroDesc: "鳥取砂丘と大山。", heroImage: PIC.nature, sections: [
    sec("鳥取の定番", [["鳥取砂丘","日本最大級の砂丘","nature"],["大山","伯耆富士の絶景","mountain"],["水木しげるロード","妖怪の街","city"],["浦富海岸","透き通る海","sea"]]) ] },
  島根: { heroLabel: "島根", heroTitle: "神話と\n縁結び", heroDesc: "出雲大社と石見銀山。", heroImage: PIC.history, sections: [
    sec("島根の定番", [["出雲大社","縁結びの大社","history"],["足立美術館","日本一の庭園","museum"],["石見銀山","世界遺産の鉱山町","history"],["松江城","国宝の天守","history"]]) ] },
  岡山: { heroLabel: "岡山", heroTitle: "名園と\n白壁の町", heroDesc: "後楽園と倉敷。", heroImage: PIC.shrine, sections: [
    sec("岡山の定番", [["岡山後楽園","日本三名園","shrine"],["倉敷美観地区","白壁の町並み","history"],["鷲羽山","瀬戸大橋の展望","sea"],["備中松山城","現存天守の山城","mountain"]]) ] },
  広島: { heroLabel: "広島", heroTitle: "平和と\n世界遺産", heroDesc: "宮島と原爆ドーム。", heroImage: PIC.shrine, sections: [
    sec("広島の定番", [["宮島・厳島神社","海上の大鳥居","shrine"],["原爆ドーム","平和の祈り","history"],["尾道","坂と猫の町","city"],["しまなみ海道","瀬戸内のサイクリング","sea"]]) ] },
  山口: { heroLabel: "山口", heroTitle: "海峡と\n絶景", heroDesc: "角島と錦帯橋。", heroImage: PIC.sea, sections: [
    sec("山口の定番", [["角島大橋","エメラルドの海上橋","sea"],["錦帯橋","木造五連アーチの名橋","history"],["元乃隅神社","海辺の朱鳥居","shrine"],["秋吉台","日本最大のカルスト","nature"]]) ] },

  徳島: { heroLabel: "徳島", heroTitle: "渦潮と\n秘境", heroDesc: "鳴門と祖谷。", heroImage: PIC.nature, sections: [
    sec("徳島の定番", [["鳴門の渦潮","迫力の自然現象","sea"],["祖谷のかずら橋","秘境の吊り橋","nature"],["大歩危・小歩危","渓谷の舟下り","nature"],["阿波おどり会館","伝統の踊り体験","museum"]]) ] },
  香川: { heroLabel: "香川", heroTitle: "うどんと\nアート", heroDesc: "栗林公園と直島。", heroImage: PIC.shrine, sections: [
    sec("香川の定番", [["栗林公園","回遊式の名庭","shrine"],["金刀比羅宮","こんぴらさん参り","history"],["父母ヶ浜","日本のウユニ塩湖","sea"],["小豆島","オリーブの島","sea"]]) ] },
  愛媛: { heroLabel: "愛媛", heroTitle: "名湯と\n名城", heroDesc: "道後温泉と松山。", heroImage: PIC.onsen, sections: [
    sec("愛媛の定番", [["道後温泉本館","日本最古級の名湯","onsen"],["松山城","現存天守の名城","history"],["しまなみ海道","島々を結ぶ絶景","sea"],["内子の町並み","白壁の歴史地区","history"]]) ] },
  高知: { heroLabel: "高知", heroTitle: "清流と\n太平洋", heroDesc: "四万十川と桂浜。", heroImage: PIC.nature, sections: [
    sec("高知の定番", [["四万十川","日本最後の清流","nature"],["桂浜","龍馬像と太平洋","sea"],["仁淀ブルー","奇跡の青い川","nature"],["足摺岬","荒波の絶景岬","sea"]]) ] },

  福岡: { heroLabel: "福岡", heroTitle: "グルメと\n歴史の街", heroDesc: "屋台と太宰府。", heroImage: PIC.gourmet, sections: [
    sec("福岡の定番", [["太宰府天満宮","学問の神様","history"],["中洲屋台","博多グルメの夜","gourmet"],["糸島","海辺のカフェ巡り","cafe"],["門司港レトロ","大正ロマンの港町","harbor"]]) ] },
  佐賀: { heroLabel: "佐賀", heroTitle: "焼き物と\n名所", heroDesc: "有田焼と吉野ヶ里。", heroImage: PIC.history, sections: [
    sec("佐賀の定番", [["吉野ヶ里歴史公園","弥生時代の集落","history"],["有田・陶磁器の里","やきものの町","museum"],["祐徳稲荷神社","日本三大稲荷","history"],["浜野浦の棚田","海に向かう棚田","sea"]]) ] },
  長崎: { heroLabel: "長崎", heroTitle: "異国情緒と\n夜景", heroDesc: "稲佐山とハウステンボス。", heroImage: PIC.city, sections: [
    sec("長崎の定番", [["稲佐山夜景","世界新三大夜景","city"],["グラバー園","異国情緒の洋館","history"],["軍艦島","世界遺産の廃墟島","sea"],["ハウステンボス","花と光のテーマパーク","city"]]) ] },
  熊本: { heroLabel: "熊本", heroTitle: "名城と\n大カルデラ", heroDesc: "熊本城と阿蘇。", heroImage: PIC.mountain, sections: [
    sec("熊本の定番", [["熊本城","復興のシンボル","history"],["阿蘇山","雄大なカルデラ","mountain"],["黒川温泉","風情ある湯の里","onsen"],["上色見熊野座神社","神秘の参道","history"]]) ] },
  大分: { heroLabel: "大分", heroTitle: "おんせん県\nおおいた", heroDesc: "別府と湯布院。", heroImage: PIC.onsen, sections: [
    sec("大分の定番", [["別府地獄めぐり","湯けむりの名所","onsen"],["湯布院温泉","由布岳を望む湯町","onsen"],["九重夢大吊橋","渓谷を渡る吊橋","nature"],["臼杵石仏","国宝の磨崖仏","history"]]) ] },
  宮崎: { heroLabel: "宮崎", heroTitle: "神話と\n南国", heroDesc: "高千穂と日南海岸。", heroImage: PIC.nature, sections: [
    sec("宮崎の定番", [["高千穂峡","神秘の渓谷","nature"],["鵜戸神宮","断崖の朱の社","shrine"],["青島神社","南国の縁結び","sea"],["日南海岸","ドライブの絶景","sea"]]) ] },
  鹿児島: { heroLabel: "鹿児島", heroTitle: "火山と\n世界遺産", heroDesc: "桜島と屋久島。", heroImage: PIC.mountain, sections: [
    sec("鹿児島の定番", [["桜島","噴煙あがる活火山","mountain"],["屋久島","縄文杉と苔の森","nature"],["指宿・砂むし温泉","天然の砂湯","onsen"],["仙巌園","桜島を望む名園","shrine"]]) ] },
  沖縄: { heroLabel: "沖縄", heroTitle: "青い海と\n琉球文化", heroDesc: "美ら海と離島。", heroImage: PIC.sea, sections: [
    sec("沖縄の定番", [["美ら海水族館","ジンベエザメの大水槽","museum"],["首里城","琉球王国の象徴","history"],["古宇利大橋","エメラルドの海上橋","sea"],["川平湾","石垣島の絶景","sea"]]) ] },
};
