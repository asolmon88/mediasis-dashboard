"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

import type {
  ActiveLocation,
  BusinessLocation,
  BusinessLocations,
} from "@/lib/types/dashboardTypes";

export const LOCATION_STORE_STORAGE_KEY = "mediasis-dashboard-active-location";
const LEGACY_ACTIVE_LOCATION_KEY = "activeLocation";
const LEGACY_BUSINESS_LOCATIONS_KEY = "businessLocations";

type LocationState = {
  locations: BusinessLocations;
  activeLocationId: string | null;
  hydrated: boolean;
  locationChangeBlocked: boolean;
  hydrate: (preferredLocationId?: string | null) => void;
  setLocations: (locations: BusinessLocations, preferredLocationId?: string | null) => void;
  selectLocation: (locationId: string | null) => void;
  upsertLocation: (location: BusinessLocation, previousLocationId?: string) => void;
  removeLocation: (locationId: string) => void;
  setLocationChangeBlocked: (blocked: boolean) => void;
  reset: () => void;
};

const resolveActiveLocationId = (
  locations: BusinessLocations,
  preferredLocationId?: string | null
) => {
  if (
    preferredLocationId &&
    locations.some((location) => location.business_location_id === preferredLocationId)
  ) {
    return preferredLocationId;
  }
  return locations[0]?.business_location_id ?? null;
};

const createLocationStore = (initialLocations: BusinessLocations) =>
  createStore<LocationState>((set) => ({
    locations: initialLocations,
    activeLocationId: resolveActiveLocationId(initialLocations),
    hydrated: false,
    locationChangeBlocked: false,
    hydrate: (preferredLocationId) =>
      set((state) => ({
        activeLocationId: resolveActiveLocationId(
          state.locations,
          preferredLocationId
        ),
        hydrated: true,
      })),
    setLocations: (locations, preferredLocationId) =>
      set((state) => ({
        locations,
        activeLocationId: resolveActiveLocationId(
          locations,
          preferredLocationId === undefined ? state.activeLocationId : preferredLocationId
        ),
      })),
    selectLocation: (locationId) =>
      set((state) => ({
        activeLocationId:
          locationId &&
          state.locations.some(
            (location) => location.business_location_id === locationId
          )
            ? locationId
            : resolveActiveLocationId(state.locations),
      })),
    upsertLocation: (location, previousLocationId) =>
      set((state) => {
        const matchId = previousLocationId ?? location.business_location_id;
        const exists = state.locations.some(
          (item) => item.business_location_id === matchId
        );
        const locations = exists
          ? state.locations.map((item) =>
              item.business_location_id === matchId ? location : item
            )
          : [...state.locations, location];
        const activeLocationId =
          state.activeLocationId === matchId
            ? location.business_location_id
            : state.activeLocationId ?? location.business_location_id;

        return { locations, activeLocationId };
      }),
    removeLocation: (locationId) =>
      set((state) => {
        const locations = state.locations.filter(
          (location) => location.business_location_id !== locationId
        );
        return {
          locations,
          activeLocationId:
            state.activeLocationId === locationId
              ? resolveActiveLocationId(locations)
              : resolveActiveLocationId(locations, state.activeLocationId),
        };
      }),
    setLocationChangeBlocked: (blocked) =>
      set({ locationChangeBlocked: blocked }),
    reset: () =>
      set({
        locations: [],
        activeLocationId: null,
        hydrated: true,
        locationChangeBlocked: false,
      }),
  }));

type LocationStore = ReturnType<typeof createLocationStore>;

const LocationStoreContext = createContext<LocationStore | null>(null);

const readPersistedLocationId = () => {
  try {
    const current = window.localStorage.getItem(LOCATION_STORE_STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      return typeof parsed === "string" ? parsed : null;
    }

    const legacy = window.localStorage.getItem(LEGACY_ACTIVE_LOCATION_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as Partial<ActiveLocation>;
    return parsed.activeLocation?.business_location_id ?? null;
  } catch {
    return null;
  }
};

export function LocationStoreProvider({
  initialLocations,
  children,
}: {
  initialLocations: BusinessLocations;
  children: ReactNode;
}) {
  const storeRef = useRef<LocationStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createLocationStore(initialLocations);
  }

  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;

    store.getState().setLocations(initialLocations);
    store.getState().hydrate(readPersistedLocationId());
    window.localStorage.removeItem(LEGACY_ACTIVE_LOCATION_KEY);
    window.localStorage.removeItem(LEGACY_BUSINESS_LOCATIONS_KEY);

    const hydratedLocationId = store.getState().activeLocationId;
    if (hydratedLocationId) {
      window.localStorage.setItem(
        LOCATION_STORE_STORAGE_KEY,
        JSON.stringify(hydratedLocationId)
      );
    }

    const unsubscribe = store.subscribe((state, previousState) => {
      if (state.activeLocationId === previousState.activeLocationId) return;
      if (state.activeLocationId) {
        window.localStorage.setItem(
          LOCATION_STORE_STORAGE_KEY,
          JSON.stringify(state.activeLocationId)
        );
      } else {
        window.localStorage.removeItem(LOCATION_STORE_STORAGE_KEY);
      }
    });

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LOCATION_STORE_STORAGE_KEY) return;
      const nextLocationId = event.newValue
        ? (JSON.parse(event.newValue) as string)
        : null;
      store.getState().selectLocation(nextLocationId);
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    storeRef.current?.getState().setLocations(initialLocations);
  }, [initialLocations]);

  return (
    <LocationStoreContext.Provider value={storeRef.current}>
      {children}
    </LocationStoreContext.Provider>
  );
}

export function useLocationStore<T>(selector: (state: LocationState) => T): T {
  const store = useContext(LocationStoreContext);
  if (!store) {
    throw new Error("useLocationStore must be used inside LocationStoreProvider");
  }
  return useStore(store, selector);
}

export const useBusinessLocations = () =>
  useLocationStore((state) => state.locations);

export const useActiveLocationId = () =>
  useLocationStore((state) => state.hydrated ? state.activeLocationId : null);

export const useActiveLocation = () =>
  useLocationStore((state) =>
    state.hydrated
      ? state.locations.find(
          (location) => location.business_location_id === state.activeLocationId
        )
      : undefined
  );

export const resetPersistedLocation = (store?: StoreApi<LocationState>) => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(LOCATION_STORE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_ACTIVE_LOCATION_KEY);
    window.localStorage.removeItem(LEGACY_BUSINESS_LOCATIONS_KEY);
  }
  store?.getState().reset();
};
