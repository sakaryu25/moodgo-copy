// アプリ全体を包む ErrorBoundary。描画中の例外で真っ白になるのを防ぎ、
// やさしいフォールバック画面＋「もう一度試す」を表示。捕捉したエラーは監視へ送る。
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { reportError } from '@/lib/crashReporting';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    reportError(error, 'boundary', { componentStack: info?.componentStack?.slice(0, 1500) });
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={s.root}>
        <View style={s.emoji}><Text style={{ fontSize: 44 }}>🙏</Text></View>
        <Text style={s.title}>問題が発生しました</Text>
        <Text style={s.sub}>
          ご迷惑をおかけします。{'\n'}「もう一度試す」を押すか、アプリを再起動してください。
        </Text>
        <TouchableOpacity onPress={this.reset} activeOpacity={0.85} style={{ marginTop: 26, width: 220 }}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
            <Text style={s.btnText}>もう一度試す</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F1EF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emoji: { marginBottom: 18 },
  title: { fontSize: 22, fontWeight: '900', color: '#1E0753' },
  sub: { fontSize: 14, color: '#7C6BA8', textAlign: 'center', lineHeight: 22, marginTop: 12 },
  btn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '900', color: '#fff' },
});
