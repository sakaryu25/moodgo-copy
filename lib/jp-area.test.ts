import { describe, it, expect } from "vitest";
import { toArea } from "./jp-area";

describe("toArea（都道府県＋市区町村の抽出）", () => {
  it("県＋市＋区（丁目・番地は落とす）", () => {
    expect(toArea("神奈川県横浜市西区みなとみらい2-3-1")).toBe("神奈川県横浜市西区");
  });
  it("都＋区", () => {
    expect(toArea("東京都渋谷区神南1-2-3")).toBe("東京都渋谷区");
  });
  it("道＋市＋区", () => {
    expect(toArea("北海道札幌市中央区北1条西2丁目")).toBe("北海道札幌市中央区");
  });
  it("県＋郡＋町", () => {
    expect(toArea("神奈川県三浦郡葉山町堀内1234")).toBe("神奈川県三浦郡葉山町");
  });
  it("市のみ（区なし）", () => {
    expect(toArea("東京都八王子市子安町1-1")).toBe("東京都八王子市");
  });
  it("先頭の『日本、』と郵便番号を落とす", () => {
    expect(toArea("日本、〒220-0012 神奈川県横浜市西区みなとみらい")).toBe("神奈川県横浜市西区");
  });
  it("空・未登録は空文字", () => {
    expect(toArea("")).toBe("");
    expect(toArea(null)).toBe("");
  });
  it("都道府県だけの粗い住所はそのまま", () => {
    expect(toArea("東京都")).toBe("東京都");
  });
});
