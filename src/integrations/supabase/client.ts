import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  || 'https://iorhfabjymdpdwsbtamo.supabase.co';
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined
  || 'sb_publishable_pAfTNXbaPeq1L7JPET9YEA_1Q7ffWik';

export const isSupabaseConfigured = Boolean(url && key);

export const SUPABASE_ANON_KEY = key;
export const supabase = createClient(url, key);

export const FUNCTIONS_URL = `${url}/functions/v1`;
