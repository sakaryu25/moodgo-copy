// ── MoodGo Design System ─────────────────────────────────────────────────
// UI UX Pro Max: Instagram-inspired Bright Minimal
// Warm white bg × Coral-Rose gradient × Soft shadows

export const COLORS = {
  // ── Backgrounds ─────────────────────────────────────────────────────────
  bg:       "#FAFAFA",          // Instagram-like off-white
  bgHome:   "#FFFFFF",          // ホームは純白
  bgCard:   "#FFFFFF",

  // ── Brand Colors（インスタ風コーラル × ローズ）──────────────────────────
  primary:      "#F43F5E",      // rose-500
  primaryLight: "#FB7185",      // rose-400
  secondary:    "#FB923C",      // orange-400（温かみ）
  accent:       "#8B5CF6",      // violet（さりげないアクセント）

  // ── Gradients ────────────────────────────────────────────────────────────
  gradStart:   "#F43F5E",
  gradEnd:     "#FB923C",
  gradHome:    ["#FF6B6B", "#FF8E53"] as const,  // 明るいサンセット
  gradCard:    ["rgba(244,63,94,0.06)", "rgba(251,146,60,0.03)"] as const,
  gradAccent:  ["#8B5CF6", "#EC4899"] as const,
  gradStory:   ["#F43F5E", "#FB923C", "#FBBF24"] as const, // ストーリーリング風

  // ── Text ─────────────────────────────────────────────────────────────────
  text:      "#111827",         // ほぼ黒
  textSub:   "#6B7280",         // gray-500
  textMuted: "#9CA3AF",         // gray-400
  white:     "#FFFFFF",

  // ── Cards & Surfaces（明るく・白基調）────────────────────────────────────
  card:      "#FFFFFF",
  muted:     "#FFF5F6",         // ごく薄いローズ
  border:    "#F3F4F6",         // ほぼ白のボーダー
  borderRose:"#FECDD3",         // ローズボーダー（アクティブ時）

  // ── Tab Bar（白 + ソフトシャドウ）────────────────────────────────────────
  tabBg:     "rgba(255,255,255,0.95)",
  // 要件③: ナビ上部の境界線を少し濃く（視認性向上）
  tabBorder: "rgba(0,0,0,0.10)",
  // 要件③: 非アクティブアイコンをgray-300→gray-400相当に濃く（視認性向上）
  inactive:  "#9CA3AF",         // gray-400

  // ── Status ───────────────────────────────────────────────────────────────
  success:   "#10B981",
  error:     "#EF4444",
  warning:   "#F59E0B",

  // ── Shadows（ウォームシャドウ）───────────────────────────────────────────
  shadow:    "rgba(0,0,0,0.08)",
  shadowRose:"rgba(244,63,94,0.20)",

  // ── Font ─────────────────────────────────────────────────────────────────
  font: "HiraginoMaruGothicProN",
};

export type ColorKey = keyof typeof COLORS;
