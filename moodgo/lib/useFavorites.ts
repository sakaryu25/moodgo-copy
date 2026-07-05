// お気に入りの読み書きフック。ホーム(結果)で付けたいいねと、保存/つぶやきタブを
// AsyncStorage経由で同期する（フォーカス毎に再読込）。NativeTabs移行で各タブが
// 独立ルートになったため、共有state代わりに使う。
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FAVORITES_KEY, loadJSON, saveJSON } from '@/lib/storage';
import { sameFav } from '@/lib/favKey';
import type { FavoriteItem } from '@/types/app';

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadJSON<FavoriteItem[]>(FAVORITES_KEY, []).then((f) => {
        if (alive) setFavorites(f);
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  // #監査CRITICAL: title一致だと同名別スポットが道連れ削除されるため sameFav(ID優先)で判定
  const removeFavorite = useCallback((item: FavoriteItem) => {
    setFavorites((prev) => {
      const next = prev.filter((f) => !sameFav(f, item));
      saveJSON(FAVORITES_KEY, next);
      return next;
    });
  }, []);

  return { favorites, removeFavorite };
}
