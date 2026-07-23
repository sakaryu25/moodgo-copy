// MoodGo 公開トップ（ランディング兼サポートページ）。
//   App Store Connect の「サポートURL」に設定する実在ページ（審査員が実際に開く）。
//   privacy/terms と同じ静的サーバーコンポーネント・同じタイポグラフィで統一。
export const metadata = {
  title: "MoodGo | 気分でめぐる、みんなのおすすめスポット",
  description:
    "MoodGoは、今の気分から行きたい場所を見つけられるおでかけアプリ。みんなが投稿した穴場スポットと出会えます。",
};

const CONTACT = "kento.ryuto25@gmail.com";

const wrap: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "48px 18px 64px",
  lineHeight: 1.85,
  color: "#2b2b2b",
  fontSize: 15,
  WebkitTextSizeAdjust: "100%",
  fontFamily:
    "system-ui, -apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
};
const logo: React.CSSProperties = {
  fontSize: 40,
  fontWeight: 800,
  letterSpacing: -1,
  margin: "0 0 4px",
  background: "linear-gradient(90deg, #F56CB3, #9B6BFF, #4FA3FF)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};
const tagline: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: "#1E0753", margin: "0 0 18px" };
const h2: React.CSSProperties = { fontSize: 17, fontWeight: 700, margin: "34px 0 8px", color: "#1E0753" };
const p: React.CSSProperties = { margin: "8px 0" };
const ul: React.CSSProperties = { margin: "8px 0", paddingLeft: 22 };
const muted: React.CSSProperties = { color: "#888", fontSize: 13 };
const link: React.CSSProperties = { color: "#7C3AED" };

export default function HomePage() {
  return (
    <main style={wrap}>
      <h1 style={logo}>MoodGo</h1>
      <p style={tagline}>気分でめぐる、みんなのおすすめスポット</p>

      <p style={p}>
        MoodGoは「今の気分」から行きたい場所を見つけられる、iPhone向けのおでかけアプリです。
        お腹すいた・まったりしたい・自然を感じたい——気分を選ぶだけで、
        みんなが投稿した穴場スポットを含むぴったりの場所を提案します。
      </p>
      <ul style={ul}>
        <li>気分・一緒に行く相手・距離から、あなたに合うスポットを提案</li>
        <li>地図アプリでは見つけにくい、みんなの穴場に出会える</li>
        <li>行った場所を記録してバッジを集められる</li>
        <li>あなたの知っている素敵な場所を投稿してみんなに共有できる</li>
      </ul>

      <h2 style={h2}>サポート・お問い合わせ</h2>
      <p style={p}>
        本アプリに関するご質問・不具合のご報告・ご要望は、アプリ内の
        「設定 → お問い合わせ」フォーム、または下記メールアドレスまでご連絡ください。
      </p>
      <p style={p}>
        メール：<a href={`mailto:${CONTACT}`} style={link}>{CONTACT}</a>
      </p>
      <p style={p}>
        通常2〜3営業日以内に返信いたします。不具合のご報告の際は、お使いの機種と
        発生した画面をあわせてお知らせいただけるとスムーズです。
      </p>

      <h2 style={h2}>お店・企業の方へ</h2>
      <p style={p}>
        掲載・情報修正のご依頼、店舗アカウント（認証バッジ）、広告・スポンサー掲載のご相談は
        専用窓口からお願いします。
      </p>
      <p style={p}>
        <a href="/business" style={link}>お店・企業向けお問い合わせはこちら →</a>
      </p>

      <h2 style={h2}>規約・ポリシー</h2>
      <ul style={ul}>
        <li><a href="/terms" style={link}>利用規約</a></li>
        <li><a href="/privacy" style={link}>プライバシーポリシー</a></li>
      </ul>

      <p style={{ ...muted, marginTop: 40 }}>
        © {new Date().getFullYear()} moodgo — 地図データ © OpenStreetMap contributors
      </p>
    </main>
  );
}
