// カードの外殻: 白背景・角丸24・ごく薄いシャドウ・押下で scale(0.98)・初回 fade-up。
// 画像の有無で ImageCard / TextCard を出し分ける。
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import ImageCard from './ImageCard';
import TextCard from './TextCard';
import type { Post } from './postTypes';

export default function PostCard({
  post, index = 0, onPress, onMenu,
}: {
  post: Post;
  index?: number;
  onPress: () => void;
  onMenu: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  // 初回 fade-up（下から・0.3s・カードごとに軽くstagger）
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 300, delay: Math.min(index, 8) * 45,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [enter, index]);

  const pressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const handlePress = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); };

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }, { scale }] }}>
      <Pressable onPress={handlePress} onPressIn={pressIn} onPressOut={pressOut} onLongPress={onMenu} style={s.card}>
        {post.image
          ? <ImageCard post={post} onMenu={onMenu} />
          : <TextCard post={post} onMenu={onMenu} />}
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    overflow: 'hidden',
    // ごく薄い自然なシャドウ
    shadowColor: '#1A1330',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 11,
    elevation: 2,
  },
});
