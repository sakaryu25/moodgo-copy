// お店・企業の方へ（掲載/店舗アカウント/広告の窓口）。ランディングとASCサポートURLから到達。
//   フォーム本体はクライアントコンポーネント（BusinessForm）・送信先は既存 /api/contact。
import BusinessForm from "./BusinessForm";

export const metadata = {
  title: "お店・企業の方へ | MoodGo",
  description: "MoodGoへの掲載・情報修正・店舗アカウント・広告掲載のご相談窓口です。",
};

const wrap: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "40px 18px 64px",
  lineHeight: 1.85,
  color: "#2b2b2b",
  fontSize: 15,
  WebkitTextSizeAdjust: "100%",
  fontFamily:
    "system-ui, -apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif",
};
const h1: React.CSSProperties = { fontSize: 24, fontWeight: 800, margin: "0 0 6px", color: "#1E0753" };
const h2: React.CSSProperties = { fontSize: 17, fontWeight: 700, margin: "30px 0 8px", color: "#1E0753" };
const p: React.CSSProperties = { margin: "8px 0" };
const ul: React.CSSProperties = { margin: "8px 0", paddingLeft: 22 };
const muted: React.CSSProperties = { color: "#888", fontSize: 13 };
const link: React.CSSProperties = { color: "#7C3AED" };

export default function BusinessPage() {
  return (
    <main style={wrap}>
      <h1 style={h1}>お店・企業の方へ</h1>
      <p style={muted}>MoodGo 掲載・提携のご相談窓口</p>

      <p style={p}>
        MoodGoは「今の気分」からおでかけ先を探す、若い世代向けのスポット発見アプリです。
        お店・施設の魅力が、来店意欲の高いユーザーにそのまま届きます。
      </p>

      <h2 style={h2}>スポット掲載申請（無料）</h2>
      <p style={p}>
        下のフォームからお店・スポットの情報をご入力ください。運営の審査後、
        MoodGoの検索結果とスポットページに掲載されます。気分タグを設定いただくことで、
        そのお店にぴったりの気分で探しているユーザーに届きます。
      </p>
      <BusinessForm />

      <h2 style={h2}>その他のご相談</h2>
      <ul style={ul}>
        <li><b>掲載内容の修正・削除</b> — すでに掲載されている情報の変更依頼</li>
        <li><b>店舗アカウント</b> — 認証バッジ付きアカウントでの情報発信</li>
        <li><b>広告・スポンサー掲載 / 取材・提携</b></li>
      </ul>

      <p style={{ ...p, marginTop: 18 }}>
        メールでのご連絡は <a href="mailto:kento.ryuto25@gmail.com" style={link}>kento.ryuto25@gmail.com</a> へどうぞ。
      </p>

      <p style={{ ...muted, marginTop: 32 }}>
        <a href="/" style={link}>← MoodGoトップへ</a>
      </p>
    </main>
  );
}
