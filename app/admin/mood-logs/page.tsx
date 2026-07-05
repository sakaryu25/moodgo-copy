// ルート /admin/mood-logs。実体は MoodLogAdmin.tsx に分離（PageProps型対応・監査2026-07-05）。
import MoodLogAdmin from "./MoodLogAdmin";

export default function Page() {
  return <MoodLogAdmin />;
}
