import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from './info';
import { Capacitor } from '@capacitor/core';

const supabaseUrl = `https://${projectId}.supabase.co`;

let supabaseInstance: ReturnType<typeof createSupabaseClient> | null = null;

export function createClient() {
  if (!supabaseInstance) {
    supabaseInstance = createSupabaseClient(supabaseUrl, publicAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        // ✅ Sur mobile, ne pas détecter la session dans l'URL
        // car les deep links sont gérés manuellement dans App.tsx
        detectSessionInUrl: !Capacitor.isNativePlatform(),
        storage: window.localStorage,
      }
    });
  }
  return supabaseInstance;
}