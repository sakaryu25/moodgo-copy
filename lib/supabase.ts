import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_KEY ?? "";

export const supabase = (() => {
  if (!url || !key) return null;
  try { return createClient(url, key); } catch { return null; }
})();
