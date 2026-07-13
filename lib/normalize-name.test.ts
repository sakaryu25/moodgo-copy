import { describe, it, expect } from "vitest";
import { normalizeName, isSameNameLoose, distanceMeters, isLikelySamePlace } from "./normalize-name";

describe("normalizeName", () => {
  it("カタカナ→ひらがなで同一キーになる", () => {
    expect(normalizeName("スターバックス")).toBe(normalizeName("すたーばっくす"));
  });
  it("全角半角・互換文字（半角カナ）をNFKCで吸収する", () => {
    expect(normalizeName("東京ｽｶｲﾂﾘｰ")).toBe(normalizeName("東京スカイツリー"));
  });
  it("区切り記号・空白を無視する（長音符ーは残す）", () => {
    expect(normalizeName("東京 ドリーム・パーク")).toBe(normalizeName("東京ドリームパーク"));
  });
  it("大文字小文字を無視する", () => {
    expect(normalizeName("Cafe LATTE")).toBe(normalizeName("cafe latte"));
  });
  it("日本語↔英語は別キー（正規化では吸えない＝座標で吸う想定）", () => {
    expect(normalizeName("東京スカイツリー")).not.toBe(normalizeName("Tokyo Skytree"));
  });
});

describe("isSameNameLoose", () => {
  it("表記ゆれ（カナ/半角/記号）は同一とみなす", () => {
    expect(isSameNameLoose("東京スカイツリー", "東京ｽｶｲﾂﾘｰ")).toBe(true);
    expect(isSameNameLoose("スターバックス", "すたーばっくす")).toBe(true);
  });
  it("一方が他方を包含する場合も同一（3文字以上）", () => {
    expect(isSameNameLoose("東京ドリームパーク", "ドリームパーク")).toBe(true);
  });
  it("短すぎる語での誤一致は防ぐ", () => {
    expect(isSameNameLoose("東京駅", "東京")).toBe(false);
  });
  it("日本語↔英語は名前だけでは別物", () => {
    expect(isSameNameLoose("東京スカイツリー", "Tokyo Skytree")).toBe(false);
  });
});

describe("distanceMeters", () => {
  it("緯度0.001度≒111mを概算できる", () => {
    const d = distanceMeters(35.0, 139.0, 35.001, 139.0);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });
});

describe("isLikelySamePlace", () => {
  it("名前ゆるふわ一致＋近接(≈同座標)なら同一", () => {
    expect(isLikelySamePlace("東京スカイツリー", 35.7101, 139.8107, "東京ｽｶｲﾂﾘｰ", 35.7101, 139.8107)).toBe(true);
  });
  it("名前一致でも離れていれば別物（チェーン店の別支店）", () => {
    // スターバックス同名でも約1.5km離れていれば別店舗
    expect(isLikelySamePlace("スターバックス", 35.70, 139.80, "すたーばっくす", 35.71, 139.81, 120)).toBe(false);
  });
  it("日本語↔英語は名前不一致なので座標が近くても結合しない（誤結合防止）", () => {
    expect(isLikelySamePlace("東京スカイツリー", 35.7101, 139.8107, "Tokyo Skytree", 35.7101, 139.8107)).toBe(false);
  });
  it("座標が欠けていれば名前一致だけで同一扱い", () => {
    expect(isLikelySamePlace("東京スカイツリー", null, null, "東京ｽｶｲﾂﾘｰ", null, null)).toBe(true);
  });
});
