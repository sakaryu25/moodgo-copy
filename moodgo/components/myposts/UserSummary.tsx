// ユーザー情報（自分の投稿ページ上部）。参考モックまま:
//   左=大きめ丸アイコン / 右=名前(太字・編集ボタンと同じ行) → 一言メッセージ → 📍◯◯在住。
//   ※アイコンより下（統計カード以降）はこのコンポーネントの外＝触らない。
import { Image } from 'expo-image';
import { MapPin, UserRound } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MP } from './types';

// 数字の短縮表記（2400→2.4K / 12000→1.2万）
function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export default function UserSummary({
  name, handle, iconUrl, prefecture, bio, showPrefecture = true,
  statPosts = 0, statVisited = 0, statLikes = 0, statFollowers = 0, onEdit,
}: {
  name: string; handle: string; iconUrl: string; prefecture: string;
  bio?: string;               // 一言メッセージ（プロフィール編集で設定・未設定は「まだありません」）
  showPrefecture?: boolean;   // 在住地の表示有無（プロフィール編集で設定）
  statPosts?: number;         // 投稿数
  statVisited?: number;       // 行った！された回数
  statLikes?: number;         // もらったいいね
  statFollowers?: number;     // フォロワー数
  onEdit: () => void;
}) {
  const hasBio = !!bio?.trim();
  return (
    <View style={s.row}>
      {/* 左: 丸アイコン */}
      <View style={s.avatarWrap}>
        {iconUrl ? (
          <Image source={{ uri: iconUrl }} style={s.avatar} contentFit="cover" />
        ) : (
          <View style={[s.avatar, s.avatarPh]}><UserRound size={34} color={MP.MAIN} strokeWidth={1.6} /></View>
        )}
      </View>

      {/* 右: 名前＋編集（同じ行）→ 一言メッセージ → 在住地 → 数字行 */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          <TouchableOpacity onPress={onEdit} style={s.editBtn} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="プロフィールを編集">
            <Text style={s.editText}>プロフィール編集</Text>
          </TouchableOpacity>
        </View>
        {!!handle && <Text style={s.handle} numberOfLines={1}>@{handle}</Text>}
        <Text style={[s.bio, !hasBio && s.bioEmpty]} numberOfLines={1}>
          {hasBio ? bio!.trim() : '一言メッセージはまだありません'}
        </Text>
        {!!prefecture && showPrefecture && (
          <View style={s.locRow}>
            <MapPin size={12} color="#555" strokeWidth={2.2} />
            <Text style={s.loc}>{prefecture}在住</Text>
          </View>
        )}
        {/* 数字行: 投稿 / 行った / いいね / フォロワー（モックまま）*/}
        <View style={s.statsRow}>
          <View style={s.statCol}>
            <Text style={s.statNum}>{fmt(statPosts)}</Text>
            <Text style={s.statLabel}>投稿</Text>
          </View>
          <View style={s.statCol}>
            <Text style={s.statNum}>{fmt(statVisited)}</Text>
            <Text style={s.statLabel}>行った</Text>
          </View>
          <View style={s.statCol}>
            <Text style={s.statNum}>{fmt(statLikes)}</Text>
            <Text style={s.statLabel}>いいね</Text>
          </View>
          <View style={s.statCol}>
            <Text style={s.statNum}>{fmt(statFollowers)}</Text>
            <Text style={s.statLabel}>フォロワー</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: MP.SIDE },
  avatarWrap: {
    width: 92, height: 92, borderRadius: 46, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#111', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPh: { backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },

  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  name: { flexShrink: 1, fontSize: 20, fontWeight: '800', color: MP.INK, letterSpacing: -0.4 },
  editBtn: {
    borderRadius: 999, borderWidth: 1.2, borderColor: 'rgba(0,0,0,0.14)',
    paddingHorizontal: 13, paddingVertical: 7, backgroundColor: '#fff',
  },
  editText: { fontSize: 11.5, fontWeight: '700', color: MP.INK },

  handle: { fontSize: 12.5, fontWeight: '600', color: MP.SUB, marginTop: 3 },
  bio: { fontSize: 13, fontWeight: '500', color: '#555', marginTop: 5 },
  bioEmpty: { color: '#B0ACBC' },   // 未設定は薄く「まだありません」
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  loc: { fontSize: 12, fontWeight: '600', color: '#555' },

  // 数字行（投稿/行った/いいね/フォロワー）
  statsRow: { flexDirection: 'row', marginTop: 12 },
  statCol: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 17, fontWeight: '800', color: MP.INK, letterSpacing: -0.3 },
  statLabel: { fontSize: 11, fontWeight: '600', color: MP.SUB, marginTop: 2 },
});
