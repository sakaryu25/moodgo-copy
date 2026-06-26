// プライバシーポリシー（公開ページ）。Expoアプリの設定画面からWebViewで開かれる。
// サーバーコンポーネント（静的テキスト・インタラクションなし）。
export const metadata = {
  title: "プライバシーポリシー | MoodGo",
  description: "MoodGoのプライバシーポリシー",
};

const UPDATED = "2026年6月13日";
const OPERATOR = "moodgo";
const CONTACT = "kento.ryuto25@gmail.com";

const wrap: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "28px 18px 64px",
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

export default function PrivacyPage() {
  return (
    <main style={wrap}>
      <h1 style={h1}>プライバシーポリシー</h1>
      <p style={muted}>最終更新日：{UPDATED}</p>

      <p style={p}>
        {OPERATOR}（以下「当方」）は、当方が提供するモバイルアプリケーション「MoodGo」（以下「本アプリ」）における
        利用者の個人情報および利用情報の取り扱いについて、以下のとおりプライバシーポリシー（以下「本ポリシー」）を定めます。
      </p>

      <h2 style={h2}>1. 取得する情報</h2>
      <p style={p}>本アプリは、サービス提供のために以下の情報を取得することがあります。</p>
      <ul style={ul}>
        <li>位置情報（現在地周辺のスポット検索に使用。許可された場合のみ取得します）</li>
        <li>端末を識別するための匿名ID（端末内で生成される識別子。氏名等とは紐づきません）</li>
        <li>プロフィール情報（年代・性別・お住まいの地域など。任意入力です）</li>
        <li>利用者が投稿したコンテンツ（穴場スポットの投稿、グループ内のメッセージ、プロフィール画像、ニックネーム等）</li>
        <li>プッシュ通知用のトークン（通知の配信に使用。通知を許可された場合のみ取得します）</li>
        <li>アプリの利用状況・操作ログ（検索条件、表示・お気に入り・地図閲覧などの行動、エラー・不具合情報）</li>
      </ul>

      <h2 style={h2}>2. 利用目的</h2>
      <ul style={ul}>
        <li>気分や条件に合ったスポットの検索・提案を行うため</li>
        <li>お気に入り・履歴・グループ機能など本アプリの機能を提供するため</li>
        <li>検索精度の改善およびサービスの品質向上のため</li>
        <li>不適切な投稿の検知・対応など、安全なサービス運営のため</li>
        <li>不具合の調査・修正、問い合わせへの対応のため</li>
      </ul>

      <h2 style={h2}>3. 位置情報の取り扱い</h2>
      <p style={p}>
        位置情報は、現在地周辺のスポットを検索するためにのみ使用し、利用者の許可なく継続的に追跡・保存することはありません。
        位置情報の利用は端末の設定からいつでも停止できます。停止した場合でも、地域を手動で指定して本アプリをご利用いただけます。
      </p>

      <h2 style={h2}>4. 第三者サービスへの提供</h2>
      <p style={p}>
        本アプリは、機能提供のために以下の外部サービスを利用しており、必要な範囲で情報が送信されることがあります。
        各サービスの情報の取り扱いについては、各社のプライバシーポリシーをご確認ください。
      </p>
      <ul style={ul}>
        <li>Google（Google Maps Platform / Places API：スポット情報・地図・写真の取得）</li>
        <li>Yahoo! JAPAN（Yahoo!ローカルサーチAPI：店舗・施設情報の取得）</li>
        <li>OpenAI（自由ワードの解釈・提案の生成）</li>
        <li>Supabase（データベース・ストレージ基盤）</li>
        <li>Vercel（アプリのバックエンドのホスティング）</li>
        <li>Sentry（アプリの不具合・エラー情報の収集と分析）</li>
        <li>Expo（プッシュ通知の配信基盤。通知用トークンの管理）</li>
      </ul>
      <p style={p}>
        当方は、法令に基づく場合を除き、利用者の同意なく個人情報を第三者に販売・提供することはありません。
        また、当方はトラッキング目的で個人情報を第三者に提供することはありません。
      </p>

      <h2 style={h2}>5. 利用者投稿コンテンツについて</h2>
      <p style={p}>
        利用者が投稿したスポット情報・メッセージ・画像等は、本アプリ内の他の利用者に表示されることがあります。
        当方は、不適切と判断したコンテンツを予告なく非表示・削除することがあります。詳細は利用規約をご確認ください。
      </p>

      <h2 style={h2}>6. データの保管・安全管理</h2>
      <p style={p}>
        取得した情報は、適切なアクセス制御のもとで保管します。通信は暗号化（HTTPS）により保護されます。
        ただし、インターネット上の通信・保管において完全な安全性を保証するものではありません。
      </p>

      <h2 style={h2}>7. 開示・削除等のご請求</h2>
      <p style={p}>
        利用者は、ご自身に関する情報の開示・訂正・削除・利用停止を求めることができます。
        ご希望の場合は、下記の問い合わせ先までご連絡ください。お気に入り・履歴・非表示リスト等は、アプリの設定からご自身で削除することもできます。
      </p>

      <h2 style={h2}>8. お子様の利用について</h2>
      <p style={p}>
        本アプリは、未成年者が利用する場合、保護者の同意のもとでご利用いただくことを前提としています。
      </p>

      <h2 style={h2}>9. 本ポリシーの変更</h2>
      <p style={p}>
        当方は、必要に応じて本ポリシーを変更することがあります。変更後の内容は本ページに掲載した時点で効力を生じます。
      </p>

      <h2 style={h2}>10. お問い合わせ窓口</h2>
      <p style={p}>
        運営者：{OPERATOR}
        <br />
        連絡先：<a href={`mailto:${CONTACT}`} style={{ color: "#7C3AED" }}>{CONTACT}</a>
      </p>

      <p style={{ ...muted, marginTop: 40 }}>© {OPERATOR} — MoodGo</p>
    </main>
  );
}
