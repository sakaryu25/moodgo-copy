import { BlurView } from 'expo-blur';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

type Tab = 'home' | 'history' | 'favorites' | 'featured';

type Props = {
  homeView: Tab;
  onChangeView: (v: Tab) => void;
  insets: EdgeInsets;
  lang?: 'ja' | 'en';
};

const ACCENT   = '#FF6B35';
const INACTIVE = '#8E8E93';

const LABELS: Record<'ja' | 'en', Record<Tab, string>> = {
  ja: { home: 'ホーム', history: '履歴', favorites: 'お気に入り', featured: '特集' },
  en: { home: 'Home',   history: 'History', favorites: 'Favorites', featured: 'Featured' },
};

function IconHome({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 21.5 21.5" fill={color}>
      <Path fillRule="evenodd" clipRule="evenodd" d="M7.75 16C7.33579 16 7 16.3358 7 16.75C7 17.1642 7.33579 17.5 7.75 17.5H13.75C14.1642 17.5 14.5 17.1642 14.5 16.75C14.5 16.3358 14.1642 16 13.75 16H7.75Z" />
      <Path fillRule="evenodd" clipRule="evenodd" d="M10.75 0C10.0419 0 9.39853 0.20282 8.70055 0.54224C8.02585 0.870345 7.24642 1.35409 6.27286 1.95832L4.20628 3.2409C3.28509 3.81261 2.54744 4.2704 1.9789 4.70581C1.39015 5.15669 0.937948 5.61589 0.61131 6.21263C0.285355 6.80812 0.138567 7.44174 0.06819 8.1907C0 8.91654 0 9.80411 0 10.9172V12.5299C0 14.4337 0 15.9366 0.152703 17.1116C0.309372 18.317 0.638563 19.2901 1.38236 20.0594C2.12958 20.8324 3.08046 21.1777 4.25761 21.3414C5.39849 21.5 6.85556 21.5 8.69185 21.5H12.8081C14.6444 21.5 16.1015 21.5 17.2424 21.3414C18.4195 21.1777 19.3704 20.8324 20.1176 20.0594C20.8614 19.2901 21.1906 18.317 21.3473 17.1116C21.5 15.9366 21.5 14.4338 21.5 12.5299V10.9172C21.5 9.80414 21.5 8.91652 21.4318 8.1907C21.3614 7.44174 21.2146 6.80812 20.8887 6.21263C20.5621 5.61589 20.1099 5.15669 19.5211 4.70581C18.9526 4.2704 18.2149 3.81262 17.2937 3.24091L15.2271 1.95831C14.2536 1.35409 13.4741 0.870342 12.7994 0.54224C12.1015 0.202819 11.4581 0 10.75 0Z" />
    </Svg>
  );
}

function IconHistory({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z" />
      <Path d="M12.5 7H11v6l5.2 3.2.8-1.3-4.5-2.7V7z" />
    </Svg>
  );
}

function IconFavorites({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 21.5 18.7157" fill={color}>
      <Path fillRule="evenodd" clipRule="evenodd" d="M4.37436 1.88993C2.71537 2.64825 1.5 4.45196 1.5 6.60283C1.5 8.80023 2.39922 10.494 3.68829 11.9455C4.75072 13.1418 6.03684 14.1334 7.29113 15.1003C7.58904 15.33 7.88515 15.5583 8.17605 15.7876C8.70208 16.2023 9.17132 16.5663 9.62361 16.8306C10.0761 17.095 10.4404 17.2157 10.75 17.2157C11.0596 17.2157 11.4239 17.095 11.8764 16.8306C12.3287 16.5663 12.7979 16.2023 13.324 15.7876C13.6149 15.5583 13.911 15.33 14.2089 15.1003C15.4632 14.1334 16.7493 13.1418 17.8117 11.9455C19.1008 10.494 20 8.80023 20 6.60283C20 4.45196 18.7846 2.64825 17.1256 1.88993C15.5139 1.15321 13.3483 1.34831 11.2904 3.48647C11.149 3.63336 10.9539 3.71637 10.75 3.71637C10.5461 3.71637 10.351 3.63336 10.2096 3.48647C8.15166 1.34831 5.98607 1.15321 4.37436 1.88993Z" />
    </Svg>
  );
}

function IconFeatured({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </Svg>
  );
}

const TABS: { key: Tab; Icon: React.ComponentType<{ color: string }> }[] = [
  { key: 'home',      Icon: IconHome },
  { key: 'history',   Icon: IconHistory },
  { key: 'favorites', Icon: IconFavorites },
  { key: 'featured',  Icon: IconFeatured },
];

export default function TabBar({ homeView, onChangeView, insets, lang = 'ja' }: Props) {
  const labels = LABELS[lang];
  return (
    <View style={s.container}>
      <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
      <View style={s.border} />
      <View style={[s.inner, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map(({ key, Icon }) => {
          const active = homeView === key;
          const color  = active ? ACCENT : INACTIVE;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => onChangeView(key)}
              style={s.tab}
              activeOpacity={0.6}
            >
              <Icon color={color} />
              <Text style={[s.label, { color }]}>{labels[key]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    zIndex: 200,
    overflow: 'hidden',
  },
  border: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  inner: {
    flexDirection: 'row',
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
});
