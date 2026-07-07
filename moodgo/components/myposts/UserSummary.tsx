// ユーザー情報（自分の投稿ページ上部）。参考モックまま:
//   左=大きめ丸アイコン / 右=名前(太字・編集ボタンと同じ行) → 一言メッセージ → 📍◯◯在住。
//   ※アイコンより下（統計カード以降）はこのコンポーネントの外＝触らない。
import { Image } from 'expo-image';
import { MapPin, UserRound } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MP } from './types';

export default function UserSummary({
  name, handle, iconUrl, prefecture, bio, showPrefecture = true, onEdit,
}: {
  name: string; handle: string; iconUrl: string; prefecture: string;
  bio?: string;               // 一言メッセージ（プロフィール編集で設定・未設定は定型文）
  showPrefecture?: boolean;   // 在住地の表示有無（プロフィール編集で設定）
  onEdit: () => void;
}) {
  return (
    <View style={s.row}>
      {/* 左: 丸アイコン（名前〜在住地の3行ぶんの高さ） */}
      <View style={s.avatarWrap}>
        {iconUrl ? (
          <Image source={{ uri: iconUrl }} style={s.avatar} contentFit="cover" />
        ) : (
          <View style={[s.avatar, s.avatarPh]}><UserRound size={34} color={MP.MAIN} strokeWidth={1.6} /></View>
        )}
      </View>

      {/* 右: 名前＋編集（同じ行）→ 一言メッセージ → 在住地 */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          <TouchableOpacity onPress={onEdit} style={s.editBtn} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="プロフィールを編集">
            <Text style={s.editText}>プロフィール編集</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.bio} numberOfLines={1}>
          {bio?.trim() || '日本中の穴場スポットを探しています。'}
        </Text>
        {!!prefecture && showPrefecture && (
          <View style={s.locRow}>
            <MapPin size={12} color="#555" strokeWidth={2.2} />
            <Text style={s.loc}>{prefecture}在住</Text>
          </View>
        )}
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

  bio: { fontSize: 13, fontWeight: '500', color: '#555', marginTop: 6 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  loc: { fontSize: 12, fontWeight: '600', color: '#555' },
});
