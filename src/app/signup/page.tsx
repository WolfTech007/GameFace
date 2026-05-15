"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  describeSignUpError,
  isSignupDuplicateEmailAuthError,
  isSignupDuplicateEmailUser,
  isUniqueViolation,
  normalizeUsername,
  validateUsernameFormat,
} from "@/lib/auth/authErrors";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { updateProfile } from "@/lib/gameface/profileStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "../login/page.module.css";

const PASSWORD_MIN = 8;

function SignupBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const finishMode = searchParams.get("finish") === "1";
  const { refreshRemoteProfile } = useGameFaceProfile();

  const [usernameRaw, setUsernameRaw] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [duplicateEmail, setDuplicateEmail] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!finishMode) return;
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!data.session?.user) {
          router.replace("/login");
          return;
        }
        const { data: row } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", data.session.user.id)
          .maybeSingle();
        if (cancelled) return;
        if (row?.username) router.replace("/");
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [finishMode, router]);

  async function onFinishProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicateEmail(false);
    setSuccess(null);

    const fmt = validateUsernameFormat(usernameRaw);
    if (fmt) {
      setError(fmt);
      return;
    }
    const username = normalizeUsername(usernameRaw);

    setPending(true);
    try {
      let supabase;
      try {
        supabase = getSupabaseBrowserClient();
      } catch {
        setError("Missing Supabase configuration. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) {
        router.replace("/login");
        return;
      }

      const { data: taken } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken?.id && taken.id !== uid) {
        setError("That username is already taken.");
        return;
      }

      const { error: insertErr } = await supabase.from("profiles").insert({ id: uid, username });
      if (insertErr && !isUniqueViolation(insertErr)) {
        setError(insertErr.message || "Could not save profile.");
        return;
      }

      updateProfile({ userId: uid, username, displayName: username });
      await refreshRemoteProfile();
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicateEmail(false);
    setSuccess(null);

    const fmt = validateUsernameFormat(usernameRaw);
    if (fmt) {
      setError(fmt);
      return;
    }
    const username = normalizeUsername(usernameRaw);

    const em = email.trim();
    if (!em.length) {
      setError("Enter your email.");
      return;
    }

    const pw = password;
    const confirm = confirmPassword;

    if (pw !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    if (pw.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
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

      const { data: taken } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken?.id) {
        setError("That username is already taken.");
        return;
      }

      const origin = typeof window !== "undefined" ? window.location.origin : undefined;
      const { data, error: signErr } = await supabase.auth.signUp({
        email: em,
        password: pw,
        options: {
          emailRedirectTo: origin ? `${origin}/login` : undefined,
          data: { username },
        },
      });

      if (signErr) {
        if (isSignupDuplicateEmailAuthError(signErr)) {
          setDuplicateEmail(true);
          return;
        }
        setError(describeSignUpError(signErr));
        return;
      }

      const signupUser = data.user ?? null;
      if (isSignupDuplicateEmailUser(signupUser)) {
        setDuplicateEmail(true);
        return;
      }

      if (!data.session?.user) {
        if (!signupUser) {
          setError("Could not complete signup. Try again.");
          return;
        }
        setSuccess("Check your email to confirm your account!");
        return;
      }

      const uid = data.session.user.id;
      const { error: insertErr } = await supabase.from("profiles").insert({
        id: uid,
        username,
      });

      if (insertErr && !isUniqueViolation(insertErr)) {
        setError(insertErr.message || "Could not create profile.");
        return;
      }

      updateProfile({
        userId: uid,
        username,
        displayName: username,
      });
      await refreshRemoteProfile();
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (finishMode) {
    return (
      <>
        <h1 className={styles.title}>Finish setup</h1>
        <p className={styles.sub}>Pick a username for your account.</p>

        {error ? (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        ) : null}

        <form className={styles.form} onSubmit={(e) => void onFinishProfile(e)}>
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

        <p className={styles.linksRow}>
          <Link href="/login" className={styles.inlineLink}>
            Sign in
          </Link>
        </p>

        <Link href="/" className={styles.skip}>
          Back to home
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.title}>Create account</h1>
      <p className={styles.sub}>Choose a username and sign up with email.</p>

      {duplicateEmail ? (
        <p className={styles.errorText} role="alert">
          Email already in use.{" "}
          <Link href="/login" className={styles.inlineLink}>
            Log in?
          </Link>
        </p>
      ) : null}

      {error ? (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className={styles.successText} role="status">
          {success}
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
            disabled={!!success}
          />
        </label>
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
            disabled={!!success}
          />
        </label>
        <label className={styles.label}>
          Password
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={!!success}
          />
        </label>
        <label className={styles.label}>
          Confirm password
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            disabled={!!success}
          />
        </label>
        <button type="submit" className={styles.submit} disabled={pending || !!success}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>

      <p className={styles.linksRow}>
        Already have an account?{" "}
        <Link href="/login" className={styles.inlineLink}>
          Sign in
        </Link>
      </p>

      <Link href="/" className={styles.skip}>
        Back to home
      </Link>
    </>
  );
}

export default function SignupPage() {
  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <p className={styles.brand}>GAMEFACE</p>
        <Suspense fallback={<p className={styles.sub}>Loading…</p>}>
          <SignupBody />
        </Suspense>
      </div>
    </main>
  );
}
