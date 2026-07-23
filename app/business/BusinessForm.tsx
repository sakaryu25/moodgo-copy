"use client";
// お店・企業のスポット掲載申請フォーム（/business）。
//   送信先は既存 POST /api/suggestions（multipart・画像アップロード・NGワード・IPレート制限つき）。
//   source='business' で送る＝サーバー側で必ず status='pending'（admin審査後に検索へ掲載）。
//   タグは検索側の正本 lib/predefined-tags.ts / lib/mood-deepdive.ts から取る＝検索にそのまま効く。
//   投稿画面(moodgo/app/post.tsx)と項目を揃えつつ、企業向けに営業情報を細かく入力できる。
import { useMemo, useState } from "react";
import { TAG_CATEGORIES } from "@/lib/predefined-tags";
import { MOOD_DEEP_DIVE } from "@/lib/mood-deepdive";

const MOOD_TAGS = TAG_CATEGORIES.find((c) => c.key === "mood")?.tags ?? [];
const BUDGET_TAGS = (TAG_CATEGORIES.find((c) => c.key === "budget")?.tags ?? []).filter((t) => t !== "#未定");

// 企業向けの追加属性（suggestionsに専用カラムが無いため紹介文へ構造的に併記する）。
const DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const RESERVE = ["予約可", "要予約", "予約不可"];
const PARKING = ["駐車場あり", "駐車場なし", "近隣にコインP"];
const PAYMENTS = ["現金", "クレジットカード", "QR・電子マネー"];
const SEATING = ["個室あり", "カウンターあり", "テラス席", "座敷・掘りごたつ", "禁煙", "喫煙可"];

const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #ddd6ee",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 15,
  marginTop: 4,
  fontFamily: "inherit",
  background: "#fff",
};
const label: React.CSSProperties = { display: "block", marginTop: 18, fontWeight: 700, color: "#1E0753", fontSize: 14 };
const req: React.CSSProperties = { color: "#E5476E", fontSize: 12, marginLeft: 4 };
const hint: React.CSSProperties = { color: "#888", fontSize: 12.5, margin: "4px 0 0", fontWeight: 400 };
const chipWrap: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 };
const section: React.CSSProperties = {
  fontSize: 15, fontWeight: 800, color: "#1E0753", marginTop: 34, marginBottom: 2,
  paddingBottom: 6, borderBottom: "2px solid #EEE8FB",
};

function Chip({ label: text, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      style={{
        border: on ? "1.5px solid #8B5CF6" : "1px solid #ddd6ee",
        background: on ? "#F2ECFE" : "#fff",
        color: on ? "#6D28D9" : "#555",
        borderRadius: 999, padding: "7px 13px", fontSize: 13.5,
        fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: "inherit",
      }}>
      {text.replace(/^#/, "")}
    </button>
  );
}

export default function BusinessForm() {
  // 基本情報
  const [spotName, setSpotName] = useState("");
  const [address, setAddress] = useState("");
  const [station, setStation] = useState("");
  const [description, setDescription] = useState("");
  // 気分・ジャンル（検索）
  const [moods, setMoods] = useState<string[]>([]);
  const [deep, setDeep] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [priceNote, setPriceNote] = useState("");
  // 営業情報（構造化・投稿画面と同じ考え方＋企業向けに詳細）
  const [is24h, setIs24h] = useState(false);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const [closedDays, setClosedDays] = useState<string[]>([]);
  const [reserve, setReserve] = useState("");
  const [parking, setParking] = useState("");
  const [payments, setPayments] = useState<string[]>([]);
  const [seating, setSeating] = useState<string[]>([]);
  // 期間限定掲載（任意・投稿画面の availableFrom/Until 相当）
  const [availFrom, setAvailFrom] = useState("");
  const [availUntil, setAvailUntil] = useState("");
  // メディア・連絡先
  const [tel, setTel] = useState("");
  const [web, setWeb] = useState("");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  // 選んだ気分の深掘り(サブジャンル)候補を L1＋L2 フラットで（投稿画面と同じ体験・重複排除）
  const deepOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string }[] = [];
    for (const m of moods) {
      for (const o of MOOD_DEEP_DIVE[m] ?? []) {
        if (!seen.has(o.key)) { seen.add(o.key); out.push(o); }
      }
    }
    return out;
  }, [moods]);

  const toggleMood = (tag: string) => {
    const next = moods.includes(tag) ? moods.filter((t) => t !== tag) : moods.length < 3 ? [...moods, tag] : moods;
    setMoods(next);
    const validKeys = new Set<string>();
    for (const m of next) for (const o of MOOD_DEEP_DIVE[m] ?? []) validKeys.add("#" + o.key);
    setDeep((prev) => prev.filter((t) => validKeys.has(t)));
  };
  const toggleDeep = (tag: string) =>
    setDeep((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  const toggleIn = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // 構造化した営業時間を文字列へ（投稿画面 composedHours と同じ組み立て方）
  const composedHours = (() => {
    const closed = closedDays.length > 0 ? `${DAYS.filter((d) => closedDays.includes(d)).join("・")}曜定休` : "";
    const core = is24h ? "24時間営業" : openTime && closeTime ? `${openTime}〜${closeTime}` : "";
    return core ? (closed ? `${core}（${closed}）` : core) : closed;
  })();

  const emailOk = /.+@.+\..+/.test(email.trim());
  const canSend =
    !!spotName.trim() && !!address.trim() && !!description.trim() && moods.length > 0 && emailOk && state !== "sending";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setState("sending");
    setErrMsg("");
    try {
      const fd = new FormData();
      fd.set("spotName", spotName.trim());
      fd.set("address", address.trim());
      if (station.trim()) fd.set("stationInfo", station.trim());
      // 紹介文に営業情報を構造的に併記（suggestionsに専用カラムが無いため。表示で読みやすい形）
      const dp = [description.trim()];
      if (composedHours) dp.push(`【営業時間】${composedHours}`);
      if (budget) dp.push(`【予算】${budget.replace(/^#/, "")}${priceNote.trim() ? `（${priceNote.trim()}）` : ""}`);
      else if (priceNote.trim()) dp.push(`【予算】${priceNote.trim()}`);
      if (reserve) dp.push(`【予約】${reserve}`);
      if (parking) dp.push(`【駐車場】${parking}`);
      if (payments.length) dp.push(`【支払い】${payments.join("・")}`);
      if (seating.length) dp.push(`【席・空間】${seating.join("・")}`);
      if (web.trim()) dp.push(`【Web/SNS】${web.trim()}`);
      fd.set("description", dp.join("\n"));
      // 連絡先はadmin確認用（審査結果の連絡先）。公開ページには出ない
      const contactParts = [`担当:${person.trim() || "（未記入）"}`, email.trim()];
      if (tel.trim()) contactParts.push(`TEL:${tel.trim()}`);
      fd.set("contact", contactParts.join(" / "));
      fd.set("posterName", spotName.trim());
      fd.set("source", "business");   // ← サーバーで必ずpending(admin審査)になる
      if (availFrom) fd.set("availableFrom", availFrom);
      if (availUntil) fd.set("availableUntil", availUntil);
      // 検索に効くタグ: 気分＋深掘り(現在の気分に有効なもの)＋予算タグ
      const validDeep = deep.filter((t) => deepOptions.some((o) => "#" + o.key === t));
      fd.set("autoTags", JSON.stringify([...moods, ...validDeep, ...(budget ? [budget] : [])]));
      for (const f of files.slice(0, 5)) fd.append("images", f);
      const res = await fetch("/api/suggestions", { method: "POST", body: fd });
      const d = await res.json().catch(() => null);
      if (d?.ok) setState("done");
      else { setState("error"); setErrMsg(d?.error || "送信できませんでした。時間をおいてお試しください。"); }
    } catch {
      setState("error");
      setErrMsg("送信できませんでした。通信環境をご確認ください。");
    }
  };

  if (state === "done") {
    return (
      <div style={{ background: "#F5F0FF", borderRadius: 14, padding: "22px 20px", marginTop: 18 }}>
        <p style={{ margin: 0, fontWeight: 700, color: "#1E0753" }}>掲載申請を受け付けました。</p>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "#555" }}>
          運営が内容を審査のうえ掲載します（通常2〜3営業日）。結果はご記入いただいた
          メールアドレスへご連絡いたします。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 8 }}>
      {/* ── 基本情報 ── */}
      <label style={label}>店舗・スポット名<span style={req}>必須</span>
        <input style={input} value={spotName} onChange={(e) => setSpotName(e.target.value)}
          maxLength={80} placeholder="例：海が見えるカフェ Mood" />
      </label>
      <label style={label}>住所<span style={req}>必須</span>
        <input style={input} value={address} onChange={(e) => setAddress(e.target.value)}
          maxLength={160} placeholder="例：神奈川県鎌倉市長谷1-2-3" />
        <p style={hint}>都道府県から番地まで。地図上の位置の特定に使います</p>
      </label>
      <label style={label}>最寄り駅・アクセス
        <input style={input} value={station} onChange={(e) => setStation(e.target.value)}
          maxLength={80} placeholder="例：江ノ電 長谷駅 徒歩5分" />
      </label>
      <label style={label}>お店・スポットの紹介<span style={req}>必須</span>
        <textarea style={{ ...input, minHeight: 120, resize: "vertical" }} value={description}
          onChange={(e) => setDescription(e.target.value)} maxLength={1500}
          placeholder="おすすめポイント・雰囲気・人気メニューなど、ユーザーに伝えたい魅力をご記入ください" />
      </label>

      {/* ── 気分・ジャンル（検索マッチ）── */}
      <div style={section}>気分・ジャンル（検索に反映）</div>
      <label style={label}>どんな気分に合う？<span style={req}>必須</span>
        <p style={hint}>最大3つ。選んだ気分で探しているユーザーの検索結果に表示されやすくなります</p>
      </label>
      <div style={chipWrap}>
        {MOOD_TAGS.map((tag) => (
          <Chip key={tag} label={tag} on={moods.includes(tag)} onToggle={() => toggleMood(tag)} />
        ))}
      </div>

      {deepOptions.length > 0 && (
        <>
          <label style={label}>もっと具体的に（ジャンル・雰囲気）
            <p style={hint}>当てはまるものを選ぶと、より狙った検索に表示されます（任意・複数可）</p>
          </label>
          <div style={chipWrap}>
            {deepOptions.map((o) => {
              const tag = "#" + o.key;
              return <Chip key={o.key} label={o.label} on={deep.includes(tag)} onToggle={() => toggleDeep(tag)} />;
            })}
          </div>
        </>
      )}

      <label style={label}>予算帯（1人あたり）</label>
      <div style={chipWrap}>
        {BUDGET_TAGS.map((tag) => (
          <Chip key={tag} label={tag} on={budget === tag} onToggle={() => setBudget(budget === tag ? "" : tag)} />
        ))}
      </div>
      <input style={{ ...input, marginTop: 8 }} value={priceNote} onChange={(e) => setPriceNote(e.target.value)}
        maxLength={120} placeholder="補足があれば（例：ランチ800円〜／ディナー3,000円〜）" />

      {/* ── 営業情報（企業向けに詳しく）── */}
      <div style={section}>営業情報</div>
      <label style={label}>営業時間</label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={is24h} onChange={(e) => setIs24h(e.target.checked)} />
          24時間営業
        </label>
        {!is24h && (
          <>
            <input type="time" style={{ ...input, width: 130, marginTop: 0 }} value={openTime}
              onChange={(e) => setOpenTime(e.target.value)} aria-label="開店時刻" />
            <span style={{ color: "#888" }}>〜</span>
            <input type="time" style={{ ...input, width: 130, marginTop: 0 }} value={closeTime}
              onChange={(e) => setCloseTime(e.target.value)} aria-label="閉店時刻" />
          </>
        )}
      </div>
      <label style={label}>定休日</label>
      <div style={chipWrap}>
        {DAYS.map((d) => (
          <Chip key={d} label={`${d}曜`} on={closedDays.includes(d)} onToggle={() => toggleIn(closedDays, setClosedDays, d)} />
        ))}
      </div>

      <label style={label}>予約</label>
      <div style={chipWrap}>
        {RESERVE.map((r) => (
          <Chip key={r} label={r} on={reserve === r} onToggle={() => setReserve(reserve === r ? "" : r)} />
        ))}
      </div>
      <label style={label}>駐車場</label>
      <div style={chipWrap}>
        {PARKING.map((p) => (
          <Chip key={p} label={p} on={parking === p} onToggle={() => setParking(parking === p ? "" : p)} />
        ))}
      </div>
      <label style={label}>支払い方法</label>
      <div style={chipWrap}>
        {PAYMENTS.map((p) => (
          <Chip key={p} label={p} on={payments.includes(p)} onToggle={() => toggleIn(payments, setPayments, p)} />
        ))}
      </div>
      <label style={label}>席・空間</label>
      <div style={chipWrap}>
        {SEATING.map((sopt) => (
          <Chip key={sopt} label={sopt} on={seating.includes(sopt)} onToggle={() => toggleIn(seating, setSeating, sopt)} />
        ))}
      </div>

      {/* ── 期間限定掲載（任意）── */}
      <div style={section}>期間限定の掲載（任意）</div>
      <p style={hint}>期間限定メニューやイベントなど、掲載期間を区切りたい場合にご記入ください</p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <input type="date" style={{ ...input, width: 170, marginTop: 0 }} value={availFrom}
          onChange={(e) => setAvailFrom(e.target.value)} aria-label="掲載開始日" />
        <span style={{ color: "#888" }}>〜</span>
        <input type="date" style={{ ...input, width: 170, marginTop: 0 }} value={availUntil}
          onChange={(e) => setAvailUntil(e.target.value)} aria-label="掲載終了日" />
      </div>

      {/* ── 写真・メディア ── */}
      <div style={section}>写真・リンク</div>
      <label style={label}>写真（最大5枚）
        <p style={hint}>お店の外観・内観・看板メニューなど。掲載ページに表示されます</p>
        <input type="file" accept="image/*" multiple style={{ ...input, padding: "8px 10px" }}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
      </label>
      {files.length > 0 && (
        <p style={hint}>{files.length}枚選択中：{files.map((f) => f.name).join(" / ")}</p>
      )}
      <label style={label}>WebサイトやInstagram
        <input style={input} value={web} onChange={(e) => setWeb(e.target.value)}
          maxLength={200} placeholder="例：https://instagram.com/…" />
      </label>
      <label style={label}>電話番号
        <input style={input} value={tel} onChange={(e) => setTel(e.target.value)}
          maxLength={20} placeholder="例：0467-00-0000" />
      </label>

      {/* ── 申請者の連絡先（審査用・非公開）── */}
      <div style={section}>ご担当者の連絡先（審査用・非公開）</div>
      <label style={label}>ご担当者名
        <input style={input} value={person} onChange={(e) => setPerson(e.target.value)}
          maxLength={50} placeholder="例：山田 太郎" />
      </label>
      <label style={label}>連絡先メールアドレス<span style={req}>必須</span>
        <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          maxLength={120} placeholder="例：info@example.com" />
        <p style={hint}>審査結果のご連絡に使用します（アプリには表示されません）</p>
      </label>
      {!emailOk && email.trim() !== "" && (
        <p style={{ color: "#E5476E", fontSize: 12.5, margin: "6px 0 0" }}>メールアドレスの形式をご確認ください</p>
      )}

      {state === "error" && (
        <p style={{ color: "#E5476E", fontSize: 13.5, margin: "12px 0 0" }}>{errMsg}</p>
      )}
      <button type="submit" disabled={!canSend}
        style={{
          marginTop: 24, width: "100%", border: "none", borderRadius: 999, padding: "13px 0",
          fontSize: 15.5, fontWeight: 800, color: "#fff", cursor: canSend ? "pointer" : "default",
          background: canSend ? "linear-gradient(90deg, #F56CB3, #9B6BFF, #4FA3FF)" : "#d6cfeb",
        }}>
        {state === "sending" ? "送信中…" : "掲載を申請する"}
      </button>
      <p style={{ ...hint, marginTop: 10 }}>
        送信いただいた内容は運営の審査後に掲載されます。詳細タグや表示内容は運営側で調整する場合があります。
      </p>
    </form>
  );
}
