// 利用規約（公開ページ）。Expoアプリの設定画面からWebViewで開かれる。
// サーバーコンポーネント（静的テキスト）。
export const metadata = {
  title: "利用規約 | MoodGo",
  description: "MoodGoの利用規約",
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

export default function TermsPage() {
  return (
    <main style={wrap}>
      <h1 style={h1}>利用規約</h1>
      <p style={muted}>最終更新日：{UPDATED}</p>

      <p style={p}>
        本利用規約（以下「本規約」）は、{OPERATOR}（以下「当方」）が提供するモバイルアプリケーション「MoodGo」
        （以下「本アプリ」）の利用条件を定めるものです。利用者は、本アプリを利用することにより本規約に同意したものとみなされます。
      </p>

      <h2 style={h2}>第1条（適用）</h2>
      <p style={p}>本規約は、本アプリの利用に関する当方と利用者との間の一切の関係に適用されます。</p>

      <h2 style={h2}>第2条（本アプリの内容）</h2>
      <p style={p}>
        本アプリは、利用者の気分や条件に応じて、お出かけ先のスポットを検索・提案するサービスです。
        提案されるスポット情報には、第三者提供のデータや利用者投稿が含まれます。当方は、表示される情報の正確性・
        最新性・安全性・特定目的への適合性を保証するものではありません。実際のご利用にあたっては、営業状況・
        立ち入りの可否・安全性等をご自身でご確認ください。
      </p>

      <h2 style={h2}>第3条（利用者投稿コンテンツ）</h2>
      <p style={p}>
        利用者は、本アプリを通じてスポット情報・メッセージ・画像等（以下「投稿コンテンツ」）を投稿できます。
        投稿コンテンツについて、利用者は自らが必要な権利を有していること、第三者の権利を侵害しないことを保証するものとします。
      </p>
      <p style={p}>
        当方は、本アプリの提供・改善・宣伝のために必要な範囲で、投稿コンテンツを無償で利用（複製・表示・改変・配信等）できるものとします。
      </p>

      <h2 style={h2}>第4条（禁止事項）</h2>
      <p style={p}>利用者は、本アプリの利用にあたり、以下の行為をしてはなりません。</p>
      <ul style={ul}>
        <li>法令または公序良俗に違反する行為</li>
        <li>犯罪行為に関連する行為、または他者の権利・財産・名誉・プライバシーを侵害する行為</li>
        <li>暴力的・差別的・わいせつ・誹謗中傷など、不適切なコンテンツの投稿</li>
        <li>虚偽の情報、または他者を誤認させる情報の投稿</li>
        <li>立ち入りが禁止された場所への侵入を助長する行為、その他第三者に危険・迷惑を及ぼす行為</li>
        <li>本アプリの運営を妨害する行為、不正アクセス、過度な負荷をかける行為</li>
        <li>他の利用者へのハラスメント、ストーキング、なりすまし</li>
        <li>その他、当方が不適切と判断する行為</li>
      </ul>

      <h2 style={h2}>第5条（コンテンツの監視・削除）</h2>
      <p style={p}>
        当方は、投稿コンテンツを監視する義務を負いませんが、利用者からの通報または当方の判断により、
        不適切と認めたコンテンツを予告なく非表示・削除し、また違反した利用者の利用を制限することができます。
        利用者は、各投稿の通報機能、および迷惑な利用者をブロックする機能を利用できます。当方は、通報を受けた
        不適切なコンテンツについて、確認のうえ速やかに対応するよう努めます。
      </p>

      <h2 style={h2}>第6条（位置情報・第三者サービス）</h2>
      <p style={p}>
        本アプリは現在地周辺の検索に位置情報を利用し、また外部サービス（Google、Yahoo! JAPAN、OpenAI 等）を利用します。
        情報の取り扱いの詳細はプライバシーポリシーをご確認ください。
      </p>

      <h2 style={h2}>第7条（免責事項）</h2>
      <ul style={ul}>
        <li>当方は、本アプリにより提供される情報および利用の結果について、いかなる保証も行いません。</li>
        <li>本アプリの利用または利用できないことによって利用者に生じた損害について、当方は一切の責任を負いません。</li>
        <li>利用者間または利用者と第三者との間で生じたトラブルについて、当方は責任を負いません。</li>
        <li>当方は、本アプリの内容を予告なく変更・中断・終了することができます。</li>
      </ul>

      <h2 style={h2}>第8条（規約の変更）</h2>
      <p style={p}>
        当方は、必要と判断した場合、利用者に通知することなく本規約を変更できるものとします。
        変更後に本アプリを利用した場合、変更後の規約に同意したものとみなされます。
      </p>

      <h2 style={h2}>第9条（準拠法・管轄）</h2>
      <p style={p}>
        本規約の解釈には日本法を準拠法とします。本アプリに関して紛争が生じた場合には、当方の所在地を管轄する裁判所を専属的合意管轄とします。
      </p>

      <h2 style={h2}>第10条（お問い合わせ）</h2>
      <p style={p}>
        運営者：{OPERATOR}
        <br />
        連絡先：<a href={`mailto:${CONTACT}`} style={{ color: "#7C3AED" }}>{CONTACT}</a>
      </p>

      <p style={{ ...muted, marginTop: 40 }}>© {OPERATOR} — MoodGo</p>
    </main>
  );
}
