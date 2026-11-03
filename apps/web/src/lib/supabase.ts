import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anon);

// null when not configured — the App shows a setup hint instead of crashing
export const supabase = supabaseConfigured ? createClient(url!, anon!) : null;
