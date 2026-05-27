"use client";

import React, { useState } from "react";
import { Home, Clock, Heart, Star, Search, ChevronRight } from "lucide-react";

// ── 7地域データ ───────────────────────────────────────────────────────────────
type Region = {
  id: string;
  label: string;
  emoji: string;
  color: string;
  /** ボタン位置（コンテナ %） */
  btn: { top: number; left?: number; right?: number };
  /** 折れ線の中継点（コンテナ %） — 省略すると直線 */
  mid?: { x: number; y: number };
  /** 地図上の到達点（コンテナ %） */
  dot: { x: number; y: number };
};

const REGIONS: Region[] = [
  {
    id: "hokkaido",
    label: "北海道・東北",
    emoji: "❄️",
    color: "#5BA8D0",
    btn: { top: 14, left: 26 },
    mid: { x: 62, y: 17 },
    dot: { x: 71, y: 11 },
  },
  {
    id: "chubu",
    label: "中部",
    emoji: "⛰️",
    color: "#6DB86D",
    btn: { top: 38, left: 26 },
    mid: { x: 55, y: 41 },
    dot: { x: 59, y: 43 },
  },
  {
    id: "chugoku",
    label: "中国",
    emoji: "⛩️",
    color: "#C9B840",
    btn: { top: 52, left: 2 },
    mid: { x: 22, y: 55 },
    dot: { x: 33, y: 52 },
  },
  {
    id: "kanto",
    label: "関東",
    emoji: "🗼",
    color: "#E8924A",
    btn: { top: 46, right: 2 },
    mid: { x: 72, y: 49 },
    dot: { x: 67, y: 46 },
  },
  {
    id: "kinki",
    label: "近畿",
    emoji: "🏯",
    color: "#9B7CC8",
    btn: { top: 60, left: 39 },
    mid: { x: 46, y: 57 },
    dot: { x: 45, y: 54 },
  },
  {
    id: "shikoku",
    label: "四国",
    emoji: "🌊",
    color: "#3BAAA0",
    btn: { top: 70, left: 20 },
    mid: { x: 38, y: 66 },
    dot: { x: 41, y: 62 },
  },
  {
    id: "kyushu",
    label: "九州・沖縄",
    emoji: "🌴",
    color: "#E07070",
    btn: { top: 77, left: 2 },
    mid: { x: 16, y: 75 },
    dot: { x: 22, y: 60 },
  },
];

const BTN_H = 3.8; // ボタン高さ（コンテナ高さの%）
const BTN_W: Record<string, number> = {
  hokkaido: 30, chubu: 21, chugoku: 21, kanto: 21,
  kinki: 21, shikoku: 21, kyushu: 28,
};

function getPath(r: Region): string {
  const bw = BTN_W[r.id] ?? 24;
  const midY = r.btn.top + BTN_H / 2;

  // ボタン接続側の座標
  let x1: number, y1: number;
  if (r.btn.left !== undefined) {
    x1 = r.btn.left + bw;
    y1 = midY;
  } else {
    x1 = 100 - (r.btn.right ?? 0) - bw;
    y1 = midY;
  }

  if (r.mid) {
    // 折れ線 L字形: ボタン → 中継点 → 到達点
    return `M${x1},${y1} L${r.mid.x},${y1} L${r.mid.x},${r.mid.y} L${r.dot.x},${r.dot.y}`;
  }
  return `M${x1},${y1} L${r.dot.x},${r.dot.y}`;
}

// ── Navigation ────────────────────────────────────────────────────────────────
const NAV = [
  { label: "ホーム",     Icon: Home  },
  { label: "履歴",       Icon: Clock },
  { label: "お気に入り", Icon: Heart },
  { label: "特集",       Icon: Star  },
] as const;

// ── StatusBar ─────────────────────────────────────────────────────────────────
function StatusBar() {
  return (
    <div className="flex justify-between items-center px-6 pt-4 pb-2">
      <span className="text-[15px] font-semibold text-gray-900" style={{ letterSpacing: "-0.3px" }}>9:41</span>
      <div className="flex items-center gap-[6px]">
        <div className="flex items-end gap-[2px]">
          {[5, 7, 9, 11].map((h, i) => (
            <div key={i} className="w-[3px] bg-gray-900 rounded-[1px]"
              style={{ height: `${h}px`, opacity: i < 1 ? 0.3 : 1 }} />
          ))}
        </div>
        <svg width="16" height="12" viewBox="0 0 24 18" fill="none">
          <path d="M12 14a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" fill="#1C1C1E" />
          <path d="M6.3 11.4 8.1 13.4C9.8 11.9 10.8 11 12 11s2.2.9 3.9 2.4l1.8-2C15.6 9.3 13.9 8 12 8s-3.6 1.3-5.7 3.4z" fill="#1C1C1E" />
          <path d="M1.5 6 3.3 7.7C5.5 5.4 8.6 4 12 4s6.5 1.4 8.7 3.7L22.5 6C20.1 3.3 16.3 1.5 12 1.5S3.9 3.3 1.5 6z" fill="#1C1C1E" />
        </svg>
        <div className="flex items-center">
          <div className="relative flex items-center"
            style={{ width: 25, height: 13, border: "1.5px solid #1C1C1E", borderRadius: 3.5 }}>
            <div className="absolute bg-gray-900 rounded-[1.5px]"
              style={{ left: 1.5, top: 1.5, bottom: 1.5, right: 1.5 }} />
          </div>
          <div className="bg-gray-900" style={{ width: 2, height: 6, borderRadius: "0 1px 1px 0", marginLeft: 1 }} />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FeaturedPage() {
  const [_selected, setSelected] = useState<string | null>(null);

  return (
    <div
      className="flex flex-col h-screen max-w-[390px] mx-auto overflow-hidden select-none bg-white"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif" }}
    >
      <StatusBar />

      {/* ── Header ── */}
      <div className="flex items-end justify-between pb-3 border-b"
        style={{ paddingLeft: 22, paddingRight: 22, borderColor: "#EDEDED" }}>
        <div>
          <div className="text-[22px] font-extrabold text-gray-900"
            style={{ letterSpacing: "-0.5px", lineHeight: 1.2 }}>特集</div>
          <div className="text-[11px] mt-[2px]" style={{ color: "#9CA3AF", letterSpacing: "0.2px" }}>
            Pick your destination
          </div>
        </div>
        <button className="w-[38px] h-[38px] rounded-full flex items-center justify-center transition-transform active:scale-90"
          style={{ background: "#FFF0EA", border: "1px solid #FFD9C8" }}>
          <Search size={18} color="#F26A3D" strokeWidth={2} />
        </button>
      </div>

      {/* ── Intro ── */}
      <div className="px-5 pt-[14px] pb-2">
        <div className="inline-flex items-center gap-[5px] rounded-full text-[11px] font-semibold mb-[10px]"
          style={{ background: "#FFF0EA", border: "1px solid #FFD9C8", color: "#F26A3D", padding: "4px 10px" }}>
          🗾 6月の特集
        </div>
        <div className="text-[26px] font-extrabold text-gray-900 leading-tight mb-[3px]"
          style={{ letterSpacing: "-0.7px" }}>どこへ行く？</div>
        <div className="text-[12px]" style={{ color: "#9CA3AF" }}>エリアをタップして特集を見る</div>
      </div>

      {/* ── Map Area ── */}
      <div
        className="flex-1 relative overflow-hidden"
        style={{ background: "linear-gradient(155deg, #EDF5FF 0%, #F5F0FF 40%, #FFF5EE 100%)" }}
      >
        {/* 日本地図 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/japan-map.png"
          alt="日本地図"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
        />

        {/* SVG 折れ線 + 矢印マーカー */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            {REGIONS.map((r) => (
              <marker
                key={r.id}
                id={`arr-${r.id}`}
                markerWidth="5" markerHeight="5"
                refX="2.5" refY="2.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <circle cx="2.5" cy="2.5" r="2.5" fill={r.color} opacity="0.9" />
              </marker>
            ))}
          </defs>

          {REGIONS.map((r) => (
            <g key={r.id}>
              {/* 折れ線 */}
              <path
                d={getPath(r)}
                stroke="#C8CAD4"
                strokeWidth="0.45"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd={`url(#arr-${r.id})`}
              />
              {/* 地域ドット（外縁リング） */}
              <circle cx={r.dot.x} cy={r.dot.y} r="1.8" fill={r.color} opacity="0.15" />
              <circle cx={r.dot.x} cy={r.dot.y} r="1.0" fill={r.color} opacity="0.9" />
            </g>
          ))}
        </svg>

        {/* 地域ボタン */}
        {REGIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className="absolute z-20 flex items-center bg-white rounded-full whitespace-nowrap transition-transform duration-100 active:scale-95"
            style={{
              top: `${r.btn.top}%`,
              ...(r.btn.left !== undefined
                ? { left: `${r.btn.left}%` }
                : { right: `${r.btn.right}%` }),
              padding: "6px 10px 6px 8px",
              gap: 5,
              boxShadow: "0 2px 14px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.055)",
            }}
          >
            <div className="rounded-full flex-shrink-0"
              style={{ width: 7, height: 7, backgroundColor: r.color }} />
            <span className="text-[12px] leading-none">{r.emoji}</span>
            <span className="text-[11.5px] font-bold text-gray-900"
              style={{ letterSpacing: "-0.3px" }}>{r.label}</span>
            <ChevronRight size={11} color={r.color} strokeWidth={2.8} />
          </button>
        ))}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav className="flex bg-white border-t"
        style={{ borderColor: "#EBEBEB", paddingTop: 8, paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
        {NAV.map(({ label, Icon }) => {
          const active = label === "特集";
          return (
            <button key={label}
              className="flex-1 flex flex-col items-center gap-[3px] transition-opacity active:opacity-60">
              {active ? (
                <div className="flex items-center justify-center rounded-full"
                  style={{ width: 46, height: 28, backgroundColor: "#FFEAE0" }}>
                  <Icon size={17} color="#F26A3D" fill="#F26A3D" strokeWidth={0} />
                </div>
              ) : (
                <div className="flex items-center justify-center" style={{ width: 46, height: 28 }}>
                  <Icon size={24} color="#BBBBC0" fill="none" strokeWidth={1.8} />
                </div>
              )}
              <span className="text-[10px] font-medium"
                style={{ color: active ? "#F26A3D" : "#BBBBC0" }}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
