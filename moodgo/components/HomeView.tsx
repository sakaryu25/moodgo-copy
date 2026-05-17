import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

const BG = '#fdf8f9';

const MOODS = [
  { label: '最高！', labelEn: 'Amazing!', color: '#FFD040', ring: '#FFAA00', bg: '#FFF7D6', faceColor: '#FFE566' },
  { label: 'いい感じ', labelEn: 'Good',   color: '#5DD87A', ring: '#38C058', bg: '#E6F9EC', faceColor: '#7DE898' },
  { label: 'まあまあ', labelEn: 'OK',     color: '#60B0F0', ring: '#3890D8', bg: '#E0EEFB', faceColor: '#80C4F4' },
  { label: 'ぱっとしない', labelEn: 'Meh', color: '#A890D0', ring: '#8870B8', bg: '#EEE8F8', faceColor: '#C0A8E0' },
];

const DAY_LABELS_JA = ['月', '火', '水', '木', '金', '土', '日'];
const DAY_LABELS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function getWeekDates(): string[] {
  const today = new Date();
  const day = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

// ── Face SVGs ──────────────────────────────────────────────────────────────

function FaceSuper({ sz }: { sz: number }) {
  return (
    <Svg width={sz} height={sz} viewBox="0 0 40 40">
      {/* squint happy eyes */}
      <Path d="M10 17 Q13 12.5 16 17" fill="none" stroke="#1a0a10" strokeWidth="2.4" strokeLinecap="round" />
      <Path d="M24 17 Q27 12.5 30 17" fill="none" stroke="#1a0a10" strokeWidth="2.4" strokeLinecap="round" />
      {/* big grin */}
      <Path d="M9 24 Q20 35 31 24" fill="none" stroke="#1a0a10" strokeWidth="2.4" strokeLinecap="round" />
      {/* cheeks */}
      <Ellipse cx="8"  cy="24" rx="4.5" ry="3" fill="#FF7A9A" opacity={0.5} />
      <Ellipse cx="32" cy="24" rx="4.5" ry="3" fill="#FF7A9A" opacity={0.5} />
      {/* sparkles */}
      <Path d="M34 10 L34 15 M31.5 12.5 L36.5 12.5" stroke="#FFD040" strokeWidth="1.6" strokeLinecap="round" />
      <Path d="M5  9  L5  13 M3  11  L7  11"          stroke="#FFD040" strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  );
}

function FaceGood({ sz }: { sz: number }) {
  return (
    <Svg width={sz} height={sz} viewBox="0 0 40 40">
      {/* round eyes */}
      <Circle cx="13" cy="16" r="3"   fill="#1a0a10" />
      <Circle cx="27" cy="16" r="3"   fill="#1a0a10" />
      <Circle cx="14.4" cy="14.6" r="1.2" fill="white" />
      <Circle cx="28.4" cy="14.6" r="1.2" fill="white" />
      {/* smile */}
      <Path d="M13 25 Q20 31 27 25" fill="none" stroke="#1a0a10" strokeWidth="2.3" strokeLinecap="round" />
      {/* cheeks */}
      <Ellipse cx="9"  cy="23" rx="4" ry="2.8" fill="#FF9EAA" opacity={0.4} />
      <Ellipse cx="31" cy="23" rx="4" ry="2.8" fill="#FF9EAA" opacity={0.4} />
    </Svg>
  );
}

function FaceMeh({ sz, lidColor }: { sz: number; lidColor: string }) {
  return (
    <Svg width={sz} height={sz} viewBox="0 0 40 40">
      {/* eyes */}
      <Circle cx="13" cy="17" r="3" fill="#1a0a10" />
      <Circle cx="27" cy="17" r="3" fill="#1a0a10" />
      <Circle cx="14.2" cy="15.6" r="1.1" fill="white" />
      <Circle cx="28.2" cy="15.6" r="1.1" fill="white" />
      {/* heavy lids (same color as face bg) */}
      <Path d="M10 17 Q13 13.5 16 17 Z" fill={lidColor} />
      <Path d="M24 17 Q27 13.5 30 17 Z" fill={lidColor} />
      {/* flat mouth */}
      <Path d="M14 26 Q20 27.5 26 26" fill="none" stroke="#1a0a10" strokeWidth="2.1" strokeLinecap="round" />
    </Svg>
  );
}

function FaceBored({ sz, lidColor }: { sz: number; lidColor: string }) {
  return (
    <Svg width={sz} height={sz} viewBox="0 0 40 40">
      {/* droopy eyes */}
      <Ellipse cx="13" cy="18" rx="3" ry="2.6" fill="#1a0a10" />
      <Ellipse cx="27" cy="18" rx="3" ry="2.6" fill="#1a0a10" />
      <Circle cx="13.8" cy="16.8" r="1" fill="white" />
      <Circle cx="27.8" cy="16.8" r="1" fill="white" />
      {/* heavy droopy lids */}
      <Path d="M10 18 Q13 14 16 18 Z" fill={lidColor} />
      <Path d="M24 18 Q27 14 30 18 Z" fill={lidColor} />
      {/* frown */}
      <Path d="M13 27 Q20 23.5 27 27" fill="none" stroke="#1a0a10" strokeWidth="2.1" strokeLinecap="round" />
      {/* sweat drop */}
      <Path d="M31 9 Q32.8 11.5 31 14 Q29.2 11.5 31 9 Z" fill="#A8C8F0" />
    </Svg>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  profileAge: string;
  profileGender: string;
  lang: 'ja' | 'en';
  onStart: () => void;
  onShowProfileEdit: () => void;
  onToggleLang: () => void;
};

// ── Main ───────────────────────────────────────────────────────────────────

export default function HomeView({ profileAge, lang, onStart, onShowProfileEdit, onToggleLang }: Props) {
  const insets = useSafeAreaInsets();
  const [todayMood, setTodayMood]   = useState<number | null>(null);
  const [weekMoods, setWeekMoods]   = useState<Record<string, number>>({});
  const [streak, setStreak]         = useState(0);
  const scaleAnims = useRef(MOODS.map(() => new Animated.Value(1))).current;

  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1400, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  // load stored moods + calculate streak
  useEffect(() => {
    (async () => {
      const week = getWeekDates();
      const entries = await Promise.all(
        week.map(async (date) => {
          const val = await AsyncStorage.getItem(`mood_${date}`);
          return [date, val != null ? parseInt(val, 10) : null] as const;
        })
      );
      const map: Record<string, number> = {};
      for (const [date, val] of entries) {
        if (val != null) map[date] = val;
      }
      setWeekMoods(map);
      const today = map[todayKey()];
      if (today != null) setTodayMood(today);

      // streak: count consecutive days backwards from today
      let s = 0;
      const now = new Date();
      for (let i = 0; i < 90; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = `mood_${d.toISOString().split('T')[0]}`;
        const val = await AsyncStorage.getItem(key);
        if (val != null) s++;
        else break;
      }
      setStreak(s);
    })();
  }, []);

  const selectMood = useCallback(async (index: number) => {
    // bounce animation
    Animated.sequence([
      Animated.timing(scaleAnims[index], { toValue: 1.18, duration: 120, useNativeDriver: true }),
      Animated.spring(scaleAnims[index], { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();

    const key = todayKey();
    const wasNew = weekMoods[key] == null;
    await AsyncStorage.setItem(`mood_${key}`, String(index));
    setTodayMood(index);
    setWeekMoods((prev) => ({ ...prev, [key]: index }));
    if (wasNew) setStreak((prev) => prev + 1);
  }, [scaleAnims, weekMoods]);

  const weekDates  = getWeekDates();
  const todayStr   = todayKey();
  const dayLabels  = lang === 'en' ? DAY_LABELS_EN : DAY_LABELS_JA;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity style={s.suggestBtn} activeOpacity={0.8} onPress={() => router.push({ pathname: '/suggest', params: { lang } })}>
            <Text style={s.suggestBtnText}>
              📍 {lang === 'en' ? 'Share a spot!' : '穴場を教えて！'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.headerChip} onPress={onToggleLang} activeOpacity={0.8}>
            <Text style={s.headerChipText}>{lang === 'en' ? 'EN' : 'JP'}</Text>
          </TouchableOpacity>
          {profileAge ? (
            <TouchableOpacity style={s.headerChip} onPress={onShowProfileEdit} activeOpacity={0.8}>
              <Text style={s.headerChipText}>{profileAge}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ── Mood check-in ── */}
      <View style={s.checkin}>
        <Text style={s.checkinTitle}>
          {lang === 'en' ? "Today's mood?" : '今日の気分は？'}
        </Text>
        {streak >= 2 && (
          <Text style={s.streak}>
            {lang === 'en' ? `🔥 ${streak} day streak!` : `🔥 ${streak}日連続チェックイン！`}
          </Text>
        )}
        <Text style={s.checkinSub}>
          {todayMood != null
            ? (lang === 'en'
                ? `You picked: ${MOODS[todayMood].labelEn}`
                : `今日は「${MOODS[todayMood].label}」`)
            : (lang === 'en' ? 'Tap a face to record!' : 'タップして記録しよう！')}
        </Text>

        {/* 4 faces */}
        <View style={s.faceRow}>
          {MOODS.map((mood, i) => {
            const selected = todayMood === i;
            return (
              <Animated.View key={i} style={{ transform: [{ scale: scaleAnims[i] }] }}>
                <TouchableOpacity
                  onPress={() => selectMood(i)}
                  activeOpacity={0.85}
                  style={[
                    s.faceBtnOuter,
                    selected && { borderColor: mood.ring, borderWidth: 3 },
                  ]}
                >
                  <View style={[s.faceBtnInner, { backgroundColor: mood.bg }]}>
                    {i === 0 && <FaceSuper sz={44} />}
                    {i === 1 && <FaceGood  sz={44} />}
                    {i === 2 && <FaceMeh   sz={44} lidColor={mood.bg} />}
                    {i === 3 && <FaceBored sz={44} lidColor={mood.bg} />}
                  </View>
                  {selected && <View style={[s.selectedRing, { borderColor: mood.ring }]} />}
                </TouchableOpacity>
                <Text style={[s.faceLabel, selected && { color: mood.ring, fontWeight: '800' }]}>
                  {lang === 'en' ? mood.labelEn : mood.label}
                </Text>
              </Animated.View>
            );
          })}
        </View>

        {/* Week dots */}
        <View style={s.weekRow}>
          {weekDates.map((date, i) => {
            const moodIdx = weekMoods[date];
            const isToday = date === todayStr;
            return (
              <View key={date} style={s.dayCol}>
                <View style={[
                  s.dot,
                  moodIdx != null
                    ? { backgroundColor: MOODS[moodIdx].color }
                    : { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#e0d0d8' },
                  isToday && moodIdx == null && s.dotToday,
                ]} />
                <Text style={[s.dayLabel, isToday && s.dayLabelToday]}>
                  {dayLabels[i]}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Bottom content ── */}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 64 + 16 }]}>
        <Text style={s.brand}>MoodGo</Text>
        <Text style={s.tagline}>
          {lang === 'en'
            ? 'Find your next outing\nby mood.'
            : '今の気分で、\nおでかけ先を見つけよう。'}
        </Text>
        <View style={s.spacer} />
        <TouchableOpacity onPress={onStart} activeOpacity={0.85} style={s.startTouchable}>
          <LinearGradient
            colors={['#ffbf67', '#ff7b54']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.startBtn}
          >
            <Text style={s.startText}>
              {lang === 'en' ? 'Get started ✨' : 'はじめる ✨'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 10, zIndex: 10,
  },
  suggestBtn: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: 'rgba(255,180,140,0.18)', borderWidth: 1, borderColor: 'rgba(255,150,100,0.25)',
  },
  suggestBtnText: { color: '#cc6644', fontSize: 12, fontWeight: '700' },
  headerRight: { flexDirection: 'row', gap: 8 },
  headerChip: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#f0dfe3',
  },
  headerChipText: { color: '#9b7b82', fontSize: 12, fontWeight: '700' },

  // Check-in section
  checkin: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 20,
  },
  checkinTitle: {
    fontSize: 22, fontWeight: '700', color: '#000', letterSpacing: -0.3,
  },
  checkinSub: {
    fontSize: 13, fontWeight: '400', color: '#8E8E93', marginTop: -10,
  },
  streak: {
    fontSize: 13, fontWeight: '700', color: '#FF6B35', marginTop: -12,
  },

  faceRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  faceBtnOuter: {
    borderRadius: 999,
    borderWidth: 3,
    borderColor: 'transparent',
    padding: 2,
  },
  faceBtnInner: {
    width: 68, height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  selectedRing: {
    position: 'absolute', top: -2, left: -2, right: -2, bottom: -2,
    borderRadius: 999, borderWidth: 3,
    backgroundColor: 'transparent',
  },
  faceLabel: {
    fontSize: 11, fontWeight: '700', color: '#9b7b82',
    textAlign: 'center', marginTop: 6,
  },

  // Week dots
  weekRow: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#f0dfe3',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  dayCol: { alignItems: 'center', gap: 6 },
  dot: {
    width: 22, height: 22, borderRadius: 11,
  },
  dotToday: {
    borderColor: '#cc8899',
    borderStyle: 'dashed',
  },
  dayLabel: { fontSize: 11, fontWeight: '600', color: '#c0a8b0' },
  dayLabelToday: { color: '#cc5580', fontWeight: '800' },

  // Bottom
  bottom: { paddingHorizontal: 28, paddingTop: 8 },
  brand: {
    fontSize: 28, fontWeight: '700', color: '#000',
    letterSpacing: -0.5, marginBottom: 4,
  },
  tagline: { fontSize: 15, fontWeight: '400', color: '#8E8E93', lineHeight: 22 },
  spacer: { height: 20 },
  startTouchable: {
    shadowColor: '#ff7b54',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.40,
    shadowRadius: 20,
    elevation: 8,
  },
  startBtn: {
    height: 52, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  startText: { fontSize: 17, fontWeight: '600', color: '#fff' },
});
