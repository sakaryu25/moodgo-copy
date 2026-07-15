// ── (tabs)/_layout ─────────────────────────────────────────────────────────
// iOS標準のネイティブタブバー（UITabBar）。
// ⚠iOS26は既定でLiquid Glass（半透明の浮遊バー＋スクロールで縮むピル）になり「色が変」に見えるため、
//   backgroundColor=白で不透明化＋minimizeBehavior=never で縮ませず、従来の"ソリッドな下部バー"に固定。
// 家計簿アプリと同じ"本物の"タブバー。タブは最大5つ（履歴はホーム内ボタンから）。
// ラベルは非表示でアイコンのみ（読み上げ用にテキストは残す）。
// ⚠ disablePopToTop/disableScrollToTop は必須: 再タップをネイティブのspecial effectに
//   消費させず、JSへ JUMP_TO(no-op) を必ず届かせる（useTabReset の振り出しリセットが依存）。
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

export default function TabsLayout() {
  return (
    <NativeTabs tintColor="#7C3AED" backgroundColor="#FFFFFF" minimizeBehavior="never" labelVisibilityMode="unlabeled" disableTransparentOnScrollEdge={true}>
      <NativeTabs.Trigger name="index" disablePopToTop disableScrollToTop>
        <Label hidden>ホーム</Label>
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="favorites" disablePopToTop disableScrollToTop>
        <Label hidden>保存</Label>
        <Icon sf={{ default: 'heart', selected: 'heart.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="blog" disablePopToTop disableScrollToTop>
        <Label hidden>みんな</Label>
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="featured" disablePopToTop disableScrollToTop>
        <Label hidden>特集</Label>
        <Icon sf={{ default: 'star', selected: 'star.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile" disablePopToTop disableScrollToTop>
        <Label hidden>プロフィール</Label>
        <Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
