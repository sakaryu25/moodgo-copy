"use client";

import React, { useState } from "react";
import { Home, Clock, Heart, Star, Search, ChevronRight } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type Region = {
  id: string;
  label: string;
  emoji: string;
  color: string;
  /** ボタン位置（コンテナの %） */
  btn: { top: number; left?: number; right?: number };
  /** ボタン推定幅（コンテナ幅の %） */
  btnW: number;
  /** 地図上のドット or インセット中心（コンテナの %）*/
  dot: { x: number; y: number };
};

// ── Region Data ───────────────────────────────────────────────────────────────
// 沖縄インセットの想定位置（コンテナ %）
// インセット: bottom=4%, right=2%, width=22%, height≈16%
// → 中心 x=100-2-11=87%, y=100-4-8=88%
const REGIONS: Region[] = [
  {
    id: "hokkaido", label: "北海道", emoji: "❄️", color: "#5BA8D0",
    btn: { top: 12, left: 27 }, btnW: 26,
    dot: { x: 71, y: 10 },
  },
  {
    id: "tohoku", label: "東北", emoji: "🌲", color: "#6DB36D",
    btn: { top: 44, right: 2 }, btnW: 23,
    dot: { x: 73, y: 32 },
  },
  {
    id: "chubu", label: "中部", emoji: "⛰️", color: "#E8924A",
    btn: { top: 38, left: 22 }, btnW: 23,
    dot: { x: 58, y: 42 },
  },
  {
    id: "kanto", label: "関東", emoji: "🗼", color: "#F0A050",
    btn: { top: 55, right: 2 }, btnW: 23,
    dot: { x: 67, y: 46 },
  },
  {
    id: "kinki", label: "近畿", emoji: "🏯", color: "#9B7CC8",
    btn: { top: 63, left: 41 }, btnW: 23,
    dot: { x: 46, y: 53 },
  },
  {
    id: "chugoku", label: "中国", emoji: "🌉", color: "#7BA84A",
    btn: { top: 51, left: 2 }, btnW: 23,
    dot: { x: 35, y: 51 },
  },
  {
    id: "shikoku", label: "四国", emoji: "🌊", color: "#3BAAA0",
    btn: { top: 71, left: 21 }, btnW: 23,
    dot: { x: 43, y: 61 },
  },
  {
    id: "kyushu", label: "九州", emoji: "🌴", color: "#E07070",
    btn: { top: 76, left: 2 }, btnW: 22,
    dot: { x: 24, y: 57 },
  },
  {
    // 沖縄ボタンは左下・インセット（右下）へ矢印
    id: "okinawa", label: "沖縄", emoji: "🌺", color: "#E06080",
    btn: { top: 84, left: 2 }, btnW: 22,
    dot: { x: 87, y: 88 },   // 右下インセット中心
  },
];

const BTN_H_PCT = 3.8;

function lineCoords(r: Region) {
  const midY = r.btn.top + BTN_H_PCT / 2;
  if (r.btn.left !== undefined) {
    return { x1: r.btn.left + r.btnW, y1: midY, x2: r.dot.x, y2: r.dot.y };
  }
  const lx = 100 - (r.btn.right ?? 0) - r.btnW;
  return { x1: lx, y1: midY, x2: r.dot.x, y2: r.dot.y };
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
      <div className="flex-1 relative overflow-hidden"
        style={{ background: "linear-gradient(155deg, #EDF5FF 0%, #F5F0FF 35%, #FFF5EE 100%)" }}>

        {/* 日本地図メイン */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/japan-map.png"
          alt="日本地図"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
        />

        {/* 沖縄インセット（右下） */}
        <div
          className="absolute z-10 rounded-xl overflow-hidden"
          style={{
            bottom: "4%",
            right: "2%",
            width: "22%",
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(224,96,128,0.3)",
            boxShadow: "0 2px 10px rgba(224,96,128,0.15)",
            padding: "4px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/okinawa-map.png"
            alt="沖縄"
            className="w-full object-contain pointer-events-none"
            draggable={false}
          />
          <div className="text-center text-[9px] font-semibold pb-0.5" style={{ color: "#E06080" }}>
            沖縄
          </div>
        </div>

        {/* SVG 接続線 + 矢印 */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            {REGIONS.map((r) => (
              <marker
                key={r.id}
                id={`arrowhead-${r.id}`}
                markerWidth="4"
                markerHeight="4"
                refX="2"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,4 L4,2 Z" fill={r.color} opacity="0.85" />
              </marker>
            ))}
          </defs>
          {REGIONS.map((r) => {
            const { x1, y1, x2, y2 } = lineCoords(r);
            return (
              <g key={r.id}>
                {/* 接続線（矢印付き） */}
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#C4C8D2"
                  strokeWidth="0.45"
                  strokeLinecap="round"
                  markerEnd={`url(#arrowhead-${r.id})`}
                />
                {/* 地域ドット */}
                <circle cx={x2} cy={y2} r="1.1" fill={r.color} opacity="0.85" />
                <circle cx={x2} cy={y2} r="2" fill={r.color} opacity="0.12" />
              </g>
            );
          })}
        </svg>

        {/* 地域ボタン */}
        {REGIONS.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className="absolute z-20 flex items-center bg-white rounded-full whitespace-nowrap transition-transform duration-100 active:scale-95"
            style={{
              top: `${r.btn.top}%`,
              ...(r.btn.left !== undefined ? { left: `${r.btn.left}%` } : { right: `${r.btn.right}%` }),
              padding: "6px 10px 6px 8px",
              gap: 5,
              boxShadow: "0 2px 12px rgba(0,0,0,0.13), 0 0 0 0.5px rgba(0,0,0,0.055)",
            }}
          >
            <div className="rounded-full flex-shrink-0" style={{ width: 7, height: 7, backgroundColor: r.color }} />
            <span className="text-[12px] leading-none">{r.emoji}</span>
            <span className="text-[11.5px] font-bold text-gray-900" style={{ letterSpacing: "-0.3px" }}>
              {r.label}
            </span>
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
            <button key={label} className="flex-1 flex flex-col items-center gap-[3px] transition-opacity active:opacity-60">
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
              <span className="text-[10px] font-medium" style={{ color: active ? "#F26A3D" : "#BBBBC0" }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
