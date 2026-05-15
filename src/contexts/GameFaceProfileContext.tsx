"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  ensureProfile,
  loadProfile,
  PROFILE_KEY,
  type GameFaceProfile,
  updateProfile,
} from "@/lib/gameface/profileStore";
import { seedDemoActivity, seedDemoFriends } from "@/lib/gameface/socialStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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
        xp: 120,
      };
    }
    const p = ensureProfile();
    seedDemoFriends(p);
    seedDemoActivity();
    return p;
  });

  useLayoutEffect(() => {
    const p = ensureProfile();
    seedDemoFriends(p);
    seedDemoActivity();
    setState(p);
  }, []);

  useEffect(() => {
    let alive = true;

    try {
      const supabase = getSupabaseBrowserClient();

      async function applySessionUser(userId: string | null) {
        if (!alive || typeof window === "undefined") return;

        if (!userId) {
          localStorage.removeItem(PROFILE_KEY);
          const guest = ensureProfile();
          seedDemoFriends(guest);
          seedDemoActivity();
          setState(guest);
          return;
        }

        const { data: row, error } = await supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .eq("id", userId)
          .maybeSingle();

        if (!alive) return;

        if (error || !row) {
          updateProfile({ userId });
          const refreshed = loadProfile();
          if (refreshed) setState(refreshed);
          return;
        }

        const uname = typeof row.username === "string" ? row.username : null;
        if (uname?.length) {
          const dn =
            typeof row.display_name === "string" && row.display_name.trim().length
              ? row.display_name
              : uname;
          const av =
            typeof row.avatar_url === "string" && row.avatar_url.trim().length
              ? row.avatar_url
              : undefined;
          updateProfile({
            userId,
            username: uname,
            displayName: dn,
            avatarUrl: av,
          });
        } else {
          updateProfile({ userId });
        }

        const refreshed = loadProfile();
        if (!refreshed) return;
        seedDemoFriends(refreshed);
        seedDemoActivity();
        setState(refreshed);
      }

      supabase.auth.getSession().then(({ data }) => {
        if (!alive) return;
        void applySessionUser(data.session?.user?.id ?? null);
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_evt, session) => {
        void applySessionUser(session?.user?.id ?? null);
      });

      return () => {
        alive = false;
        subscription.unsubscribe();
      };
    } catch {
      if (process.env.NODE_ENV === "development") {
        console.error(
          "Supabase env missing — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
        );
      }
      return () => {
        alive = false;
      };
    }
  }, []);

  const refresh = useCallback(() => {
    const p = loadProfile();
    if (p) setState(p);
  }, []);

  const setProfile = useCallback((patch: Partial<GameFaceProfile>) => {
    const next = updateProfile(patch);
    setState(next);
  }, []);

  const value = useMemo(() => ({ profile, refresh, setProfile }), [profile, refresh, setProfile]);

  return (
    <GameFaceProfileContext.Provider value={value}>{children}</GameFaceProfileContext.Provider>
  );
}

export function useGameFaceProfile(): Ctx {
  const c = useContext(GameFaceProfileContext);
  if (!c) throw new Error("useGameFaceProfile must be used within GameFaceProfileProvider");
  return c;
}
