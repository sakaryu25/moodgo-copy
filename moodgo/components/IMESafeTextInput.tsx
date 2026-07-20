// IMESafeTextInput — 日本語IME（かな漢字変換）が壊れない TextInput ラッパー。
//
// 背景（New Architecture / Fabric のバグ）:
//   newArchEnabled=true（Fabric）では、制御された TextInput（value を毎キーストローク再供給）に
//   日本語を入力すると、IMEの「未確定文字（marked text）」が再レンダーのたびに確定されてしまい、
//   1文字ずつ勝手に確定して「変換」できなくなる（例:「おきなわ」と打っても「お」「き」…が即確定）。
//   親が onChangeText で複数の setState を走らせるほど（QuizFlowのエリア入力＝6連setState）顕著。
//
// 対処:
//   ・ネイティブ側は `defaultValue` で初期化し、`value` を毎回渡さない＝Reactが変換中の未確定文字を
//     上書きしない（＝変換が生きる）。
//   ・入力値は onChangeText で親stateへ流し続けるので「親stateが真実」は維持（バリデーション等はそのまま動く）。
//   ・現在地オートフィル / リセット / 復元のような “ユーザーのタイピング由来ではない” 外部変更だけ、
//     ref.setNativeProps で命令的にネイティブへ反映（このときだけ未確定は解除されるが、打鍵中ではないので無害）。
//
//   → これで「制御コンポーネントの利便（プログラム的に値を差し替えられる）」と
//      「IME変換が壊れない（打鍵中は value を再供給しない）」を両立する。
import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { TextInput, TextInputProps } from 'react-native';

type Props = Omit<TextInputProps, 'value' | 'defaultValue'> & {
  /** 論理的な値（親stateの真実）。外部から変わったときだけネイティブへ反映する。 */
  value: string;
};

const IMESafeTextInput = forwardRef<TextInput, Props>(function IMESafeTextInput(
  { value, onChangeText, ...rest },
  forwardedRef,
) {
  const innerRef = useRef<TextInput | null>(null);
  const lastEmitted = useRef<string>(value);   // 自分のonChangeTextが最後に流した値
  const [seed] = useState<string>(value);      // マウント時の初期値（defaultValue用）

  useEffect(() => {
    // 外部変更（現在地フィル/リセット/復元）＝自分の打鍵のエコーではない場合だけネイティブへ反映。
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      innerRef.current?.setNativeProps({ text: value });
    }
  }, [value]);

  return (
    <TextInput
      ref={(node) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<TextInput | null>).current = node;
      }}
      defaultValue={seed}
      onChangeText={(v) => {
        lastEmitted.current = v;          // 以降このvが親から返ってきても再反映しない（エコー無視）
        onChangeText?.(v);
      }}
      {...rest}
    />
  );
});

export default IMESafeTextInput;
