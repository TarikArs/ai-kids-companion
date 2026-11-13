import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Keeps the screen on while the Board or the Camera is open. Replaces expo-keep-awake's hook: on the web it threw
 * « The wake lock … has not activated yet » when the screen closed (reload, back) before the browser granted the lock.
 */
export function useStayAwake() {
  useEffect(() => {
    if (Platform.OS === 'web') {
      const nav = (globalThis as any).navigator;
      const doc = (globalThis as any).document;
      let lock: { release?: () => Promise<void> } | null = null;
      let off = false;
      const request = async () => {
        try {
          const l = await nav?.wakeLock?.request?.('screen');
          if (off) l?.release?.().catch(() => undefined);
          else lock = l ?? null;
        } catch {
          // not allowed (hidden tab, old browser): the screen may sleep, nothing else breaks
        }
      };
      // The browser drops the lock when the tab is hidden: ask again when it comes back.
      const onVisible = () => {
        if (!off && doc?.visibilityState === 'visible') request();
      };
      request();
      doc?.addEventListener?.('visibilitychange', onVisible);
      return () => {
        off = true;
        doc?.removeEventListener?.('visibilitychange', onVisible);
        lock?.release?.().catch(() => undefined);
      };
    }
    const tag = `stay-awake-${Math.random().toString(36).slice(2)}`;
    let on = false;
    activateKeepAwakeAsync(tag)
      .then(() => (on = true))
      .catch(() => undefined);
    return () => {
      if (!on) return;
      try {
        Promise.resolve(deactivateKeepAwake(tag)).catch(() => undefined);
      } catch {
        // already released
      }
    };
  }, []);
}
