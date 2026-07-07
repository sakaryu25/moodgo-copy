// ユーザー情報: 丸アイコン / 名前 / ひとこと / 現在地、右にプロフィール編集（既存SettingsViewへ接続）。
import { Image } from 'expo-image';
import { MapPin, UserRound } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MP } from './types';

export default function UserSummary({
  name, handle, iconUrl, prefecture, onEdit,
}: { name: string; handle: string; iconUrl: string; prefecture: string; onEdit: () => void }) {
  return (
    <View style={s.row}>
      <View style={s.avatarWrap}>
        {iconUrl ? (
          <Image source={{ uri: iconUrl }} style={s.avatar} contentFit="cover" />
        ) : (
          <View style={[s.avatar, s.avatarPh]}><UserRound size={26} color={MP.MAIN} strokeWidth={1.7} /></View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        <Text style={s.bio} numberOfLines={1}>
          {handle ? `@${handle}・` : ''}日本中の穴場スポットを探しています。
        </Text>
        {!!prefecture && (
          <View style={s.locRow}>
            <MapPin size={11} color={MP.SUB} strokeWidth={2.2} />
            <Text style={s.loc}>{prefecture}在住</Text>
          </View>
        )}
      </View>
      <TouchableOpacity onPress={onEdit} style={s.editBtn} activeOpacity={0.8}
        accessibilityRole="button" accessibilityLabel="プロフィールを編集">
        <Text style={s.editText}>プロフィール編集</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: MP.SIDE },
  avatarWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#111', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  avatar: { width: 60, height: 60, borderRadius: 30 },
  avatarPh: { backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '800', color: MP.INK, letterSpacing: -0.3 },
  bio: { fontSize: 11.5, fontWeight: '500', color: MP.SUB, marginTop: 2 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  loc: { fontSize: 11, fontWeight: '600', color: MP.SUB },
  editBtn: {
    borderRadius: 999, borderWidth: 1.2, borderColor: 'rgba(0,0,0,0.14)',
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff',
  },
  editText: { fontSize: 11.5, fontWeight: '700', color: MP.INK },
});
