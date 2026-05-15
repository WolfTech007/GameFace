"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  normalizeUsername,
  validateUsernameFormat,
} from "@/lib/auth/authErrors";
import { updateProfile } from "@/lib/gameface/profileStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "../../login/page.module.css";

/** Postgres / PostgREST unique violation */
function isConflict(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "23505") return true;
  const m = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return m.includes("duplicate") || m.includes("unique constraint");
}

export default function UsernamePage() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [usernameRaw, setUsernameRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const session = data.session ?? null;

        if (cancelled) return;
        if (!session?.user) {
          router.replace("/login");
          return;
        }

        const { data: row } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", session.user.id)
          .maybeSingle();

        if (cancelled) return;
        if (row?.username) {
          router.replace("/");
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fmt = validateUsernameFormat(usernameRaw);
    if (fmt) {
      setError(fmt);
      return;
    }
    const username = normalizeUsername(usernameRaw);

    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getUser();
      const user = data.user ?? null;

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: taken } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();

      if (taken?.id && taken.id !== user.id) {
        setError("That username is already taken.");
        return;
      }

      const { error: insertErr } = await supabase.from("profiles").insert({
        id: user.id,
        username,
      });

      if (insertErr) {
        if (isConflict(insertErr)) {
          setError("That username is already taken.");
        } else if ("code" in insertErr && insertErr.code === "42501") {
          setError("Could not save profile. Check Row Level Security in Supabase.");
        } else if ("message" in insertErr && String(insertErr.message).length) {
          setError(insertErr.message);
        } else {
          setError("Could not save profile. Try again.");
        }
        return;
      }

      updateProfile({
        userId: user.id,
        username,
        displayName: username,
      });

      router.replace("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <p className={styles.brand}>GAMEFACE</p>
        <h1 className={styles.title}>Pick a username</h1>
        <p className={styles.sub}>This is how friends see you across GameFace.</p>

        {checking ? (
          <p className={styles.sub}>Checking session…</p>
        ) : (
          <>
            {error ? (
              <p className={styles.errorText} role="alert">
                {error}
              </p>
            ) : null}

            <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
              <label className={styles.label}>
                Username
                <input
                  className={styles.input}
                  value={usernameRaw}
                  onChange={(e) => setUsernameRaw(e.target.value)}
                  placeholder="cool_player"
                  autoComplete="nickname"
                  maxLength={24}
                  required
                />
              </label>
              <button type="submit" className={styles.submit} disabled={pending}>
                {pending ? "Saving…" : "Continue"}
              </button>
            </form>
          </>
        )}

        <p className={styles.linksRow}>
          <button
            type="button"
            className={styles.inlineLinkGhost}
            onClick={() =>
              void signOut().then(() => {
                router.replace("/login");
              })
            }
          >
            Sign out
          </button>{" "}
          to use another account
        </p>

        <Link href="/" className={styles.skip}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
