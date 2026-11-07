import { useEffect } from 'react';
import { AppState } from 'react-native';

import { log } from './log';
import { useAppStore } from './store';
import { supabase } from './supabase';
import { useUnpair } from './use-unpair';

/** How often a paired Board or Camera checks that the parent has not removed it. */
const CHECK_MS = 8_000;

/**
 * The parent removed this device (Parent › Appareils › Retirer): it goes back to the first screen (« Cet appareil
 * sera… ») by itself, within a few seconds. A removed device can no longer read its own row (RLS), so « no row » with no
 * error means removed; a network error never unpairs.
 */
export function useRevokedWatch() {
  const device = useAppStore((s) => s.device);
  const unpair = useUnpair();
  useEffect(() => {
    if (!device || device.viaParent) return;
    let stopped = false;
    /** Two checks in a row must say « removed » (never on one answer, e.g. just after pairing). */
    let misses = 0;
    const check = async () => {
      const { data, error } = await supabase.from('devices').select('id, revoked_at').eq('id', device.id).maybeSingle();
      if (stopped || error) return;
      if (data && !(data as { revoked_at: string | null }).revoked_at) {
        misses = 0;
        return;
      }
      if (++misses >= 2) {
        stopped = true;
        log('device', 'removed by the parent: back to the first screen');
        await unpair();
      }
    };
    void check();
    const timer = setInterval(check, CHECK_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void check());
    return () => {
      stopped = true;
      clearInterval(timer);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id, device?.viaParent]);
}
