"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  ensureProfile,
  loadProfile,
  type GameFaceProfile,
  saveProfile,
  updateProfile as mergeProfile,
} from "@/lib/gameface/profileStore";
import { seedDemoActivity, seedDemoFriends } from "@/lib/gameface/socialStore";

type Ctx = {
  profile: GameFaceProfile;
  refresh: () => void;
  setProfile: (patch: Partial<GameFaceProfile>) => void;
};

const GameFaceProfileContext = createContext<Ctx | null>(null);

export function GameFaceProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setState] = useState<GameFaceProfile>(() => {
    if (typeof window === "undefined") {
      return {
        userId: "ssr",
        username: "player",
        displayName: "Player",
        level: 1,
        rank: "Silver I",
      };
    }
    const p = ensureProfile();
    seedDemoFriends(p);
    seedDemoActivity();
    return p;
  });

  const refresh = useCallback(() => {
    const p = loadProfile();
    if (p) setState(p);
  }, []);

  const setProfile = useCallback((patch: Partial<GameFaceProfile>) => {
    const next = mergeProfile(patch);
    setState(next);
  }, []);

  const value = useMemo(() => ({ profile, refresh, setProfile }), [profile, refresh, setProfile]);

  return <GameFaceProfileContext.Provider value={value}>{children}</GameFaceProfileContext.Provider>;
}

export function useGameFaceProfile(): Ctx {
  const c = useContext(GameFaceProfileContext);
  if (!c) throw new Error("useGameFaceProfile must be used within GameFaceProfileProvider");
  return c;
}
