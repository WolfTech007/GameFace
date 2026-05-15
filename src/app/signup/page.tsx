"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeSignUpError } from "@/lib/auth/authErrors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "../login/page.module.css";

const PASSWORD_MIN = 8;

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const em = email.trim();
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
      const supabase = getSupabaseBrowserClient();
      const origin = typeof window !== "undefined" ? window.location.origin : undefined;
      const { data, error: signErr } = await supabase.auth.signUp({
        email: em,
        password: pw,
        options: origin ? { emailRedirectTo: `${origin}/login` } : undefined,
      });

      if (signErr) {
        setError(describeSignUpError(signErr));
        return;
      }

      if (!data.session) {
        setError(
          "Check your email to confirm your account before choosing a username. Then sign in.",
        );
        return;
      }

      router.replace("/signup/username");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <p className={styles.brand}>GAMEFACE</p>
        <h1 className={styles.title}>Create account</h1>
        <p className={styles.sub}>Sign up with email. You&apos;ll pick a username next.</p>

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
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
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
            />
          </label>
          <button type="submit" className={styles.submit} disabled={pending}>
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
      </div>
    </main>
  );
}
