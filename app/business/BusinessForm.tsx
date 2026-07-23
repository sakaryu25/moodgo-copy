"use client";
// お店・企業のスポット掲載申請フォーム（/business）。
//   送信先は既存 POST /api/suggestions（multipart・画像アップロード・NGワード・IPレート制限つき）。
//   source='business' で送る＝サーバー側で必ず status='pending'（admin審査後に検索へ掲載）。
//   タグは検索側の正本 lib/predefined-tags.ts から直接import＝検索にそのまま効く値だけを選ばせる。
import { useState } from "react";
import { TAG_CATEGORIES } from "@/lib/predefined-tags";

const MOOD_TAGS = TAG_CATEGORIES.find((c) => c.key === "mood")?.tags ?? [];
const BUDGET_TAGS = (TAG_CATEGORIES.find((c) => c.key === "budget")?.tags ?? []).filter((t) => t !== "#未定");
const FOOD_TAGS = TAG_CATEGORIES.find((c) => c.key === "foodGenre")?.tags ?? [];

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

function TagChip({ tag, on, onToggle }: { tag: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      style={{
        border: on ? "1.5px solid #8B5CF6" : "1px solid #ddd6ee",
        background: on ? "#F2ECFE" : "#fff",
        color: on ? "#6D28D9" : "#555",
        borderRadius: 999, padding: "7px 13px", fontSize: 13.5,
        fontWeight: on ? 700 : 500, cursor: "pointer", fontFamily: "inherit",
      }}>
      {tag.replace(/^#/, "")}
    </button>
  );
}

export default function BusinessForm() {
  const [spotName, setSpotName] = useState("");
  const [address, setAddress] = useState("");
  const [station, setStation] = useState("");
  const [description, setDescription] = useState("");
  const [moods, setMoods] = useState<string[]>([]);
  const [foods, setFoods] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [hours, setHours] = useState("");
  const [tel, setTel] = useState("");
  const [web, setWeb] = useState("");
  const [person, setPerson] = useState("");
  const [email, setEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  const toggle = (list: string[], set: (v: string[]) => void, tag: string, max: number) => {
    if (list.includes(tag)) set(list.filter((t) => t !== tag));
    else if (list.length < max) set([...list, tag]);
  };

  const emailOk = /.+@.+\..+/.test(email.trim());
  const canSend =
    spotName.trim() && address.trim() && description.trim() && moods.length > 0 && emailOk && state !== "sending";

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
      // 紹介文に営業時間/Webを構造的に併記（suggestionsに専用カラムが無いため）
      const descParts = [description.trim()];
      if (hours.trim()) descParts.push(`【営業時間】${hours.trim()}`);
      if (web.trim()) descParts.push(`【Web/SNS】${web.trim()}`);
      fd.set("description", descParts.join("\n"));
      // 連絡先はadmin確認用（審査結果の連絡先）。公開ページには出ない
      const contactParts = [`担当:${person.trim() || "（未記入）"}`, email.trim()];
      if (tel.trim()) contactParts.push(`TEL:${tel.trim()}`);
      fd.set("contact", contactParts.join(" / "));
      fd.set("posterName", spotName.trim());
      fd.set("source", "business");   // ← サーバーで必ずpending(admin審査)になる
      fd.set("autoTags", JSON.stringify([...moods, ...foods, ...(budget ? [budget] : [])]));
      for (const f of files.slice(0, 3)) fd.append("images", f);
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

      <label style={label}>どんな気分に合う？<span style={req}>必須</span>
        <p style={hint}>最大3つ。選んだ気分の検索結果に表示されやすくなります</p>
      </label>
      <div style={chipWrap}>
        {MOOD_TAGS.map((tag) => (
          <TagChip key={tag} tag={tag} on={moods.includes(tag)}
            onToggle={() => toggle(moods, setMoods, tag, 3)} />
        ))}
      </div>

      <label style={label}>料理ジャンル（飲食店の場合）
        <p style={hint}>最大2つ</p>
      </label>
      <div style={chipWrap}>
        {FOOD_TAGS.map((tag) => (
          <TagChip key={tag} tag={tag} on={foods.includes(tag)}
            onToggle={() => toggle(foods, setFoods, tag, 2)} />
        ))}
      </div>

      <label style={label}>予算帯（1人あたり）</label>
      <div style={chipWrap}>
        {BUDGET_TAGS.map((tag) => (
          <TagChip key={tag} tag={tag} on={budget === tag}
            onToggle={() => setBudget(budget === tag ? "" : tag)} />
        ))}
      </div>

      <label style={label}>営業時間
        <input style={input} value={hours} onChange={(e) => setHours(e.target.value)}
          maxLength={120} placeholder="例：11:00〜18:00（水曜定休）" />
      </label>
      <label style={label}>電話番号
        <input style={input} value={tel} onChange={(e) => setTel(e.target.value)}
          maxLength={20} placeholder="例：0467-00-0000" />
      </label>
      <label style={label}>WebサイトやInstagram
        <input style={input} value={web} onChange={(e) => setWeb(e.target.value)}
          maxLength={200} placeholder="例：https://instagram.com/…" />
      </label>

      <label style={label}>写真（最大3枚）
        <p style={hint}>お店の外観・内観・看板メニューなど。掲載ページに表示されます</p>
        <input type="file" accept="image/*" multiple style={{ ...input, padding: "8px 10px" }}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} />
      </label>
      {files.length > 0 && (
        <p style={hint}>{files.length}枚選択中：{files.map((f) => f.name).join(" / ")}</p>
      )}

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
          marginTop: 22, width: "100%", border: "none", borderRadius: 999, padding: "13px 0",
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
