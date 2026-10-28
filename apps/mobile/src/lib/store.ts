import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppRole, DeviceRole } from '@hc/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PairedDevice {
  id: string;
  householdId: string;
  role: DeviceRole;
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
    }),
    {
      name: 'kids-companion-app',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ role, device, muted }) => ({ role, device, muted }),
      onRehydrateStorage: () => () => useAppStore.setState({ hydrated: true }),
    },
  ),
);
