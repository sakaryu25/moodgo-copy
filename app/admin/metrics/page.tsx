// ルート /admin/metrics。Next 15のPageProps生成型はカスタムprop付きdefault exportや
// 追加named exportを許さないため、実体は MetricsAdmin.tsx に分離（監査2026-07-05）。
import MetricsAdmin from "./MetricsAdmin";

export default function Page() {
  return <MetricsAdmin />;
}
