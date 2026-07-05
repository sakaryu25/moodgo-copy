// ルート /admin/blog-posts。実体は BlogPostsAdmin.tsx に分離（PageProps型対応・監査2026-07-05）。
import BlogPostsAdmin from "./BlogPostsAdmin";

export default function Page() {
  return <BlogPostsAdmin />;
}
