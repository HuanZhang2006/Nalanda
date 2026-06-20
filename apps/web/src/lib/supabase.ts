import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anon);

// 未配置时为 null —— App 会显示配置提示，而不是崩溃
export const supabase = supabaseConfigured ? createClient(url!, anon!) : null;
