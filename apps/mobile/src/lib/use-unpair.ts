import { router } from 'expo-router';

import { useAppStore } from './store';
import { supabase } from './supabase';

/** Signs the device out and forgets its role and pairing. */
export function useUnpair() {
  const reset = useAppStore((s) => s.reset);
  return async () => {
    await supabase.auth.signOut();
    reset();
    router.replace('/');
  };
}
