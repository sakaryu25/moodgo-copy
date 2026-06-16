import { describe, it, expect } from "vitest";
import { haversineMeters, distanceKmFor, formatDistText } from "./distance";

describe("haversineMeters", () => {
  it("same point → 0", () => {
    expect(haversineMeters(35.681, 139.767, 35.681, 139.767)).toBe(0);
  });
  it("1° of latitude ≈ 111.19 km", () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111194.9, 0);
  });
  it("is symmetric", () => {
    const a = haversineMeters(35.0, 139.0, 36.0, 140.0);
    const b = haversineMeters(36.0, 140.0, 35.0, 139.0);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("distanceKmFor", () => {
  it("prefers distanceM (PostGIS) over coordinates", () => {
    // distanceM=2000m → 2km, even though coords would give a huge haversine
    expect(distanceKmFor({ distanceM: 2000, lat: 0, lng: 0, originLat: 10, originLng: 10 })).toBe(2);
  });
  it("falls back to haversine from coords when no distanceM", () => {
    expect(distanceKmFor({ lat: 1, lng: 0, originLat: 0, originLng: 0 })).toBeCloseTo(111.19, 1);
  });
  it("uses fallbackKm when neither distanceM nor full coords present", () => {
    expect(distanceKmFor({ fallbackKm: 5 })).toBe(5);
    expect(distanceKmFor({ lat: 1, originLat: 0, originLng: 0, fallbackKm: 7 })).toBe(7); // lng missing
  });
  it("returns undefined when nothing usable", () => {
    expect(distanceKmFor({})).toBeUndefined();
  });
  it("ignores negative distanceM and falls through", () => {
    expect(distanceKmFor({ distanceM: -1 })).toBeUndefined();
    expect(distanceKmFor({ distanceM: -1, fallbackKm: 3 })).toBe(3);
  });
});

describe("formatDistText", () => {
  it("car uses 40km/h by default", () => {
    expect(formatDistText(12.3, "車")).toBe("車で約18分 / 12.3km");
  });
  it("walking uses 4km/h", () => {
    expect(formatDistText(2, "徒歩")).toBe("歩きで約30分 / 2.0km");
  });
  it("bicycle uses 12km/h", () => {
    expect(formatDistText(6, "自転車")).toBe("自転車で約30分 / 6.0km");
  });
  it("train shows whole hours past 60min", () => {
    expect(formatDistText(30, "電車")).toBe("電車で約1時間 / 30.0km");
  });
  it("shows hours + minutes", () => {
    expect(formatDistText(50, "車")).toBe("車で約1時間15分 / 50.0km");
  });
  it("defaults to car when transport unspecified", () => {
    expect(formatDistText(40)).toBe("車で約1時間 / 40.0km");
  });
  it("accepts transport as an array", () => {
    expect(formatDistText(2, ["徒歩"])).toBe("歩きで約30分 / 2.0km");
  });
  it("override duration text wins over the estimate", () => {
    expect(formatDistText(5, "車", "15分")).toBe("車で約15分 / 5.0km");
  });
  it("ignores blank override and falls back to estimate", () => {
    expect(formatDistText(5, "車", "   ")).toBe("車で約8分 / 5.0km"); // 5/40*60=7.5→8
  });
});
