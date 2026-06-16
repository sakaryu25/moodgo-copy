import { describe, it, expect } from "vitest";
import {
  canonDeepDive, isFoodAllowedContext, moodGroup, isRestaurantName,
  tagsAreFood, nameMatchesGenre, primaryTypeAllowedForGenre,
} from "./search-filters";

describe("canonDeepDive", () => {
  it("maps known aliases to their canonical form", () => {
    expect(canonDeepDive("中華料理")).toBe("中華");
    expect(canonDeepDive("韓国料理")).toBe("韓国");
    expect(canonDeepDive("お好み焼き")).toBe("お好み焼きもんじゃ");
  });
  it("passes through unknown values unchanged", () => {
    expect(canonDeepDive("温泉")).toBe("温泉");
    expect(canonDeepDive("")).toBe("");
  });
});

describe("isFoodAllowedContext", () => {
  it("お腹すいた always allows food regardless of deep dive", () => {
    expect(isFoodAllowedContext("お腹すいた", "温泉")).toBe(true);
  });
  it("food-oriented deep dives allow food", () => {
    expect(isFoodAllowedContext("まったり", "カフェ")).toBe(true);
    expect(isFoodAllowedContext(undefined, "グルメ")).toBe(true);
    expect(isFoodAllowedContext(undefined, "道の駅")).toBe(true);
  });
  it("non-food contexts exclude food", () => {
    expect(isFoodAllowedContext("自然感じたい", "温泉")).toBe(false);
    expect(isFoodAllowedContext(undefined, undefined)).toBe(false);
    expect(isFoodAllowedContext("集中したい", "図書館")).toBe(false);
  });
});

describe("moodGroup", () => {
  it("normalizes mood variants to their semantic group", () => {
    expect(moodGroup("お腹すいた")).toBe("food");
    expect(moodGroup("まったりしたい")).toBe("relax");
    expect(moodGroup("ドライブ")).toBe("drive");
    expect(moodGroup("体を動かしたい")).toBe("sport");
    expect(moodGroup("スリルがほしい")).toBe("play");
  });
  it("trims whitespace before lookup", () => {
    expect(moodGroup("  ドライブ  ")).toBe("drive");
  });
  it("unknown or empty → empty string", () => {
    expect(moodGroup("???")).toBe("");
    expect(moodGroup(undefined)).toBe("");
  });
});

describe("isRestaurantName", () => {
  it("detects restaurant chains and cuisine keywords", () => {
    expect(isRestaurantName("スターバックス 渋谷店")).toBe(true);
    expect(isRestaurantName("ラーメン二郎 三田本店")).toBe(true);
    expect(isRestaurantName("鳥貴族")).toBe(false); // チェーン名だが業態語なし=保険RE非対象
  });
  it("keeps leisure/onsen/sightseeing names even if they look food-ish", () => {
    expect(isRestaurantName("大江戸温泉物語")).toBe(false);
    expect(isRestaurantName("サウナ&スパ 大東洋")).toBe(false);
  });
  it("non-restaurant names → false", () => {
    expect(isRestaurantName("明治神宮")).toBe(false);
    expect(isRestaurantName("")).toBe(false);
  });
});

describe("tagsAreFood", () => {
  it("true when any food tag present", () => {
    expect(tagsAreFood(["#カフェ"])).toBe(true);
    expect(tagsAreFood(["#絶景", "#麺類"])).toBe(true);
  });
  it("false for non-food tags / empty / undefined", () => {
    expect(tagsAreFood(["#自然感じたい", "#絶景"])).toBe(false);
    expect(tagsAreFood([])).toBe(false);
    expect(tagsAreFood(undefined)).toBe(false);
  });
});

describe("nameMatchesGenre", () => {
  it("no genre or no name → always matches", () => {
    expect(nameMatchesGenre("なにか", "")).toBe(true);
    expect(nameMatchesGenre("", "うどん・そば")).toBe(true);
  });
  it("positive-required genres demand a positive keyword", () => {
    expect(nameMatchesGenre("そば処 まるた", "うどん・そば")).toBe(true);
    expect(nameMatchesGenre("焼肉キング", "うどん・そば")).toBe(false);
  });
  it("genres without rules pass through", () => {
    expect(nameMatchesGenre("どこかの食堂", "存在しない深掘り")).toBe(true);
  });
});

describe("primaryTypeAllowedForGenre", () => {
  it("allows the genre's whitelisted specific type", () => {
    expect(primaryTypeAllowedForGenre("ramen_restaurant", "ラーメン")).toBe(true);
  });
  it("rejects a different specific food type for a restricted genre", () => {
    expect(primaryTypeAllowedForGenre("sushi_restaurant", "ラーメン")).toBe(false);
    expect(primaryTypeAllowedForGenre("sushi_restaurant", "うどん・そば")).toBe(false);
  });
  it("passes generic restaurant types through (専用型が無いケースを誤除外しない)", () => {
    expect(primaryTypeAllowedForGenre("japanese_restaurant", "うどん・そば")).toBe(true);
  });
  it("excludes ALL food types for amusement deep dives", () => {
    expect(primaryTypeAllowedForGenre("ramen_restaurant", "心霊")).toBe(false);
    expect(primaryTypeAllowedForGenre("restaurant", "王道で遊ぶ")).toBe(false);
  });
  it("resolves aliases before checking the whitelist", () => {
    expect(primaryTypeAllowedForGenre("chinese_restaurant", "中華料理")).toBe(true);
  });
  it("no restriction for undefined genres", () => {
    expect(primaryTypeAllowedForGenre("museum", "存在しない深掘り")).toBe(true);
  });
});
