"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import styles from "./page.module.css";

export default function LoginPage() {
  const { setProfile } = useGameFaceProfile();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim().slice(0, 24) || "player";
    const handle = u.startsWith("@") ? u : `@${u}`;
    setProfile({
      username: handle.replace(/^@/, "").toLowerCase(),
      displayName: u.replace(/^@/, ""),
      level: 1,
      rank: "Gold II",
    });
    router.replace("/");
  }

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <p className={styles.brand}>GAMEFACE</p>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.sub}>Use your GameFace account. Session is stored on this device.</p>
        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label}>
            Username
            <input
              className={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@you"
              autoComplete="username"
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className={styles.submit}>
            Continue
          </button>
        </form>
        <Link href="/" className={styles.skip}>
          Skip for now
        </Link>
      </div>
    </main>
  );
}
