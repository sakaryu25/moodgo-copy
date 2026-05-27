"use client";

import React, { useState } from "react";
import {
  Snowflake, Mountain, TreePine, Radio,
  Flower2, Waves, Leaf, ChevronRight,
  Home, Clock, Heart, Star,
} from "lucide-react";

// ── 地方データ ────────────────────────────────────────────────────────────────
type Region = {
  id: string;
  label: string;
  Icon: React.ElementType;
  color: string;
  btnStyle: React.CSSProperties;
  mapDot: { x: number; y: number };
  btnDot: { x: number; y: number };
};

// ── 座標計算基準：cropped image 632×813, container 390×462
// image left=16px, top=0px (height=462px fits container exactly)
// svgX = (16 + x_frac*359) / 390 * 100
// svgY = y_frac * 100
const REGIONS: Region[] = [
  {
    id: "hokkaido", label: "北海道・東北", Icon: Snowflake, color: "#5BA8D0",
    btnStyle: { top: "10%", right: "2%" },
    mapDot: { x: 73, y: 15 }, btnDot: { x: 63, y: 14 },
  },
  {
    id: "chubu", label: "中部", Icon: TreePine, color: "#5FAF5F",
    btnStyle: { top: "27%", right: "2%" },
    mapDot: { x: 53, y: 38 }, btnDot: { x: 63, y: 31 },
  },
  {
    id: "kanto", label: "関東", Icon: Radio, color: "#E8924A",
    btnStyle: { top: "40%", right: "2%" },
    mapDot: { x: 73, y: 42 }, btnDot: { x: 63, y: 44 },
  },
  {
    id: "kinki", label: "近畿", Icon: Flower2, color: "#9B7CC8",
    btnStyle: { top: "36%", left: "24%" },
    mapDot: { x: 44, y: 50 }, btnDot: { x: 59, y: 40 },
  },
  {
    id: "chugoku", label: "中国", Icon: Mountain, color: "#7BA84A",
    btnStyle: { top: "28%", left: "2%" },
    mapDot: { x: 27, y: 47 }, btnDot: { x: 37, y: 32 },
  },
  {
    id: "shikoku", label: "四国", Icon: Waves, color: "#3BAAA0",
    btnStyle: { top: "54%", left: "2%" },
    mapDot: { x: 36, y: 58 }, btnDot: { x: 37, y: 58 },
  },
  {
    id: "kyushu", label: "九州・沖縄", Icon: Leaf, color: "#E07070",
    btnStyle: { top: "65%", left: "2%" },
    mapDot: { x: 20, y: 55 }, btnDot: { x: 37, y: 69 },
  },
];

// ── 日本地図画像 ──────────────────────────────────────────────────────────────
function JapanMapSVG() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/japan-map.png"
      alt="日本地図"
      style={{
        width: "92%",
        maxHeight: "92%",
        objectFit: "contain",
        userSelect: "none",
        pointerEvents: "none",
      }}
    />
  );
}

// ── RegionButton ───────────────────────────────────────────────────────────────
function RegionButton({ region, onClick }: { region: Region; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute flex items-center gap-1.5 bg-white rounded-full border border-gray-100 px-3 py-[9px] z-20 whitespace-nowrap transition-all duration-150 hover:shadow-lg active:scale-95"
      style={{
        ...region.btnStyle,
        boxShadow: "0 2px 10px rgba(0,0,0,0.10), 0 0 0 0.5px rgba(0,0,0,0.04)",
      }}
    >
      <region.Icon size={15} color={region.color} strokeWidth={2.5} />
      <span
        className="text-[13px] font-semibold text-gray-700 tracking-tight"
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif" }}
      >
        {region.label}
      </span>
      <ChevronRight size={13} color="#BBBBBB" strokeWidth={2.5} />
    </button>
  );
}

// ── SVG 接続線 ─────────────────────────────────────────────────────────────────
function ConnectionLines() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-10"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {REGIONS.map((r) => (
        <g key={r.id}>
          <line
            x1={r.mapDot.x} y1={r.mapDot.y}
            x2={r.btnDot.x} y2={r.btnDot.y}
            stroke="#C8CAD0" strokeWidth="0.45" strokeLinecap="round"
          />
          <circle cx={r.mapDot.x} cy={r.mapDot.y} r="0.9" fill={r.color} opacity="0.7" />
        </g>
      ))}
    </svg>
  );
}

// ── BottomNav ──────────────────────────────────────────────────────────────────
const NAV_TABS = [
  { label: "ホーム",     Icon: Home  },
  { label: "履歴",      Icon: Clock },
  { label: "お気に入り", Icon: Heart },
  { label: "特集",      Icon: Star  },
] as const;

function BottomNav() {
  return (
    <nav
      className="flex bg-white border-t border-gray-200 pt-2"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      {NAV_TABS.map(({ label, Icon }) => {
        const active = label === "特集";
        return (
          <button key={label} className="flex-1 flex flex-col items-center gap-[3px] py-1">
            <Icon
              size={24}
              color={active ? "#F26A3D" : "#AAAAAA"}
              fill={active ? "#F26A3D" : "none"}
              strokeWidth={active ? 2 : 1.8}
            />
            <span className="text-[10px] font-medium" style={{ color: active ? "#F26A3D" : "#AAAAAA" }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ── StatusBar ──────────────────────────────────────────────────────────────────
function StatusBar() {
  return (
    <div className="flex justify-between items-center px-6 pt-4 pb-2">
      <span className="text-[15px] font-semibold text-gray-900" style={{ letterSpacing: "-0.3px" }}>
        9:41
      </span>
      <div className="flex items-center gap-[6px]">
        <div className="flex items-end gap-[2px]">
          {[5, 7, 9, 11].map((h, i) => (
            <div key={i} className="w-[3px] bg-gray-900 rounded-[1px]"
              style={{ height: `${h}px`, opacity: i < 1 ? 0.35 : 1 }} />
          ))}
        </div>
        <svg width="16" height="12" viewBox="0 0 24 18" fill="none">
          <path d="M12 14C13.1 14 14 14.9 14 16s-.9 2-2 2-2-.9-2-2 .9-2 2-2z" fill="#1C1C1E" />
          <path d="M12 9c2.2 0 4.2.9 5.7 2.4l1.8-2C17.4 7.3 14.9 6 12 6S6.6 7.3 4.5 9.4l1.8 2C7.8 9.9 9.8 9 12 9z" fill="#1C1C1E" />
          <path d="M12 4c3.4 0 6.5 1.4 8.7 3.7L22.5 6C20.1 3.3 16.3 1.5 12 1.5S3.9 3.3 1.5 6l1.8 1.7C5.5 5.4 8.6 4 12 4z" fill="#1C1C1E" />
        </svg>
        <div className="flex items-center">
          <div className="relative flex items-center"
            style={{ width: 25, height: 13, border: "1.5px solid #1C1C1E", borderRadius: 3.5 }}>
            <div className="absolute bg-gray-900 rounded-[1.5px]"
              style={{ left: 1.5, top: 1.5, bottom: 1.5, right: 1.5 }} />
          </div>
          <div className="bg-gray-900"
            style={{ width: 2, height: 6, borderRadius: "0 1px 1px 0", marginLeft: 1 }} />
        </div>
      </div>
    </div>
  );
}

// ── メインページ ───────────────────────────────────────────────────────────────
export default function AreaSelectPage() {
  const [_selected, setSelected] = useState<string | null>(null);

  return (
    <div
      className="flex flex-col h-screen max-w-[390px] mx-auto overflow-hidden select-none"
      style={{
        background: "#FFFFFF",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif",
      }}
    >
      <StatusBar />

      <div className="relative flex items-center justify-center py-3 border-b"
        style={{ borderColor: "#E8E8EC", background: "#FFFFFF" }}>
        <h1 className="text-[17px] font-semibold text-gray-900">特集</h1>
      </div>

      <div className="px-6 pt-4 pb-1">
        <h2 className="font-bold text-gray-900 mb-1 leading-tight"
          style={{ fontSize: 25, letterSpacing: "-0.5px" }}>
          エリアを選ぶ
        </h2>
        <p className="text-[13px] leading-snug" style={{ color: "#888" }}>
          行きたいエリアを選ぶと、特集ページが見られます。
        </p>
      </div>

      {/* マップエリア */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          <JapanMapSVG />
        </div>
        <ConnectionLines />
        {REGIONS.map((r) => (
          <RegionButton key={r.id} region={r} onClick={() => setSelected(r.id)} />
        ))}
      </div>

      <BottomNav />
    </div>
  );
}
