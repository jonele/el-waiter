import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DbWaiterProfile, DbTable } from "@/lib/waiterDb";

export type Theme = 'dark' | 'grey' | 'light';

export interface WaiterSettings {
  bridgeUrl:         string;
  btEnabled:         boolean;
  minConsumptionEur: number;
}

const DEFAULTS: WaiterSettings = {
  bridgeUrl:         "http://localhost:8088",
  btEnabled:         false,
  minConsumptionEur: 0,
};

interface WaiterState {
  waiter:          DbWaiterProfile | null;
  activeTable:     DbTable | null;
  settings:        WaiterSettings;
  theme:           Theme;
  isOnline:        boolean;
  pendingSyncs:    number;
  deviceVenueId:   string | null;
  currentShiftId:  string | null;

  login:             (w: DbWaiterProfile) => void;
  logout:            () => void;
  setCurrentShiftId: (id: string | null) => void;
  setActiveTable:    (t: DbTable | null) => void;
  updateSettings:    (u: Partial<WaiterSettings>) => void;
  setTheme:          (t: Theme) => void;
  setOnline:         (v: boolean) => void;
  setPendingSyncs:   (n: number)  => void;
  setDeviceVenueId:  (id: string | null) => void;
}

export const useWaiterStore = create<WaiterState>()(
  persist(
    (set) => ({
      waiter:          null,
      activeTable:     null,
      settings:        DEFAULTS,
      theme:           'dark' as Theme,
      isOnline:        true,
      pendingSyncs:    0,
      deviceVenueId:   null,
      currentShiftId:  null,

      login:             (waiter)  => set({ waiter }),
      logout:            ()        => set({ waiter: null, activeTable: null, currentShiftId: null }),
      setCurrentShiftId: (id)      => set({ currentShiftId: id }),
      setActiveTable:    (t)       => set({ activeTable: t }),
      updateSettings:    (u)       => set((s) => ({ settings: { ...s.settings, ...u } })),
      setTheme:          (theme)   => set({ theme }),
      setOnline:         (isOnline)     => set({ isOnline }),
      setPendingSyncs:   (pendingSyncs) => set({ pendingSyncs }),
      setDeviceVenueId:  (deviceVenueId) => set({ deviceVenueId }),
    }),
    {
      name:    "el-waiter",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ waiter: s.waiter, settings: s.settings, theme: s.theme, deviceVenueId: s.deviceVenueId, currentShiftId: s.currentShiftId }),
    }
  )
);
