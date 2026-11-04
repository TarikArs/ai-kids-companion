import { router } from 'expo-router';

import { log } from './log';
import { useAppStore } from './store';
import { supabase } from './supabase';

/** Signs the device out and forgets its role and pairing. Never blocked by the network. */
export function useUnpair() {
  const reset = useAppStore((s) => s.reset);
  return async () => {
    reset();
    router.replace('/');
    // Local sign-out: no server call, so it cannot hang or fail offline.
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      log('unpair', 'sign-out failed (ignored)', (e as Error).message);
    }
  };
}
