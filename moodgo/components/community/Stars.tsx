// おすすめ度の星（金 #FFB400）。rating<=0 は非表示。
import { Star } from 'lucide-react-native';
import { View } from 'react-native';

const GOLD = '#FFB400';
const EMPTY = '#E6E3EC';

export default function Stars({ n, size = 13 }: { n: number; size?: number }) {
  if (n <= 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 1.5 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} color={i <= n ? GOLD : EMPTY} fill={i <= n ? GOLD : EMPTY} strokeWidth={0} />
      ))}
    </View>
  );
}
