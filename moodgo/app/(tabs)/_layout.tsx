// ── (tabs)/_layout ─────────────────────────────────────────────────────────
// iOS標準のネイティブタブバー（UITabBar）。iOS26では自動的にLiquid Glassになる。
// 家計簿アプリと同じ"本物の"タブバー。タブは最大5つ（履歴はホーム内ボタンから）。
// ラベルは非表示でアイコンのみ（読み上げ用にテキストは残す）。
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

export default function TabsLayout() {
  return (
    <NativeTabs tintColor="#7C3AED" minimizeBehavior="onScrollDown" labelVisibilityMode="unlabeled">
      <NativeTabs.Trigger name="index">
        <Label hidden>ホーム</Label>
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="favorites">
        <Label hidden>保存</Label>
        <Icon sf={{ default: 'heart', selected: 'heart.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="blog">
        <Label hidden>みんな</Label>
        <Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="groups">
        <Label hidden>つぶやき</Label>
        <Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="featured">
        <Label hidden>特集</Label>
        <Icon sf={{ default: 'star', selected: 'star.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
