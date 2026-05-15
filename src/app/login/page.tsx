"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { describeSignInError } from "@/lib/auth/authErrors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

function LoginFields() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectSafe = sanitizeRedirect(searchParams.get("redirect"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const em = email.trim();
    if (!em.length) {
      setError("Enter your email.");
      return;
    }

    setPending(true);
    try {
      let supabase;
      try {
        supabase = getSupabaseBrowserClient();
      } catch {
        setError("Missing Supabase configuration. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        return;
      }

      const { data, error: signErr } = await supabase.auth.signInWithPassword({
        email: em,
        password,
      });

      if (signErr) {
        setError(describeSignInError(signErr));
        return;
      }

      const user = data.user;
      if (!user) {
        setError("Sign-in failed. Try again.");
        return;
      }

      const { data: row } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();

      if (!row?.username) {
        router.replace("/signup/username");
        router.refresh();
        return;
      }

      router.replace(redirectSafe);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.sub}>Use your GameFace account. Session persists on this device.</p>

      {error ? (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}

      <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
        <label className={styles.label}>
          Email
          <input
            className={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label className={styles.label}>
          Password
          <input
            className={styles.input}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className={styles.linksRow}>
        New here?{" "}
        <button type="button" className={styles.inlineLinkGhost} onClick={() => router.push("/signup")}>
          Create account
        </button>
      </div>

      <Link href="/" className={styles.skip}>
        Back to home
      </Link>
    </>
  );
}

function sanitizeRedirect(raw: string | null): string {
  const fallback = "/";
  if (!raw?.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw === "/login" || raw === "/signup") return fallback;
  return raw;
}

export default function LoginPage() {
  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <p className={styles.brand}>GAMEFACE</p>
        <Suspense fallback={<p className={styles.sub}>Loading…</p>}>
          <LoginFields />
        </Suspense>
      </div>
    </main>
  );
}
