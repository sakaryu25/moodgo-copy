// 超軽量トースト（単一のルートマウント <CopyToast/> が購読）
export type ToastMsg = { title: string; subtitle?: string };
type Listener = (m: ToastMsg) => void;

let listener: Listener | null = null;

export function subscribeToast(cb: Listener): () => void {
  listener = cb;
  return () => { if (listener === cb) listener = null; };
}

export function showToast(title: string, subtitle?: string): void {
  listener?.({ title, subtitle });
}
