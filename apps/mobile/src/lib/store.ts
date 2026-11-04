import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppRole, DeviceRole } from '@hc/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PairedDevice {
  id: string;
  householdId: string;
  role: DeviceRole;
  /** The parent's own phone used as the Camera (no pairing, the parent stays signed in). */
  viaParent?: boolean;
}

interface AppStore {
  hydrated: boolean;
  /** What this device is used as. Chosen once on first launch. */
  role: AppRole | null;
  /** Set once a Board or Camera has been paired with a household. */
  device: PairedDevice | null;
  /** Board: text only, no voice at all. */
  muted: boolean;
  setMuted: (muted: boolean) => void;
  setRole: (role: AppRole | null) => void;
  setDevice: (device: PairedDevice | null) => void;
  reset: () => void;
  /** Soft restart of every screen (Board "Recharger"): screens are remounted and load everything again. */
  reloadKey: number;
  reload: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      hydrated: false,
      role: null,
      device: null,
      muted: false,
      setMuted: (muted) => set({ muted }),
      setRole: (role) => set({ role }),
      setDevice: (device) => set({ device }),
      reset: () => set({ role: null, device: null }),
      reloadKey: 0,
      reload: () => set((s) => ({ reloadKey: s.reloadKey + 1 })),
    }),
    {
      name: 'kids-companion-app',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ role, device, muted }) => ({ role, device, muted }),
      onRehydrateStorage: () => () => useAppStore.setState({ hydrated: true }),
    },
  ),
);
