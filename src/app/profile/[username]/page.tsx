"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { GFBottomNav } from "@/components/gameface";
import { ProfileAvatar } from "@/components/gameface/ProfileAvatar";
import { ProfilePlaceholderSections } from "@/components/gameface/ProfilePlaceholderSections";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { fetchProfileByUsername, type PublicProfile } from "@/lib/gameface/profilesClient";
import styles from "./page.module.css";

function isSignedInProfile(username: string | undefined): boolean {
  if (!username) return false;
  return !username.startsWith("guest_");
}

export default function PublicProfilePage() {
  const params = useParams();
  const { profile: self } = useGameFaceProfile();
  const signedIn = isSignedInProfile(self.username);

  const rawUsername = typeof params.username === "string" ? params.username : "";
  const [data, setData] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOwnProfile =
    signedIn && data && self.username.toLowerCase() === data.username.toLowerCase();

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    if (!rawUsername) {
      setError("Profile not found.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchProfileByUsername(rawUsername)
      .then((p) => {
        if (!cancelled) setData(p);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Profile not found.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rawUsername, signedIn]);

  if (!signedIn) {
    return (
      <div className={styles.shell}>
        <main className={styles.root}>
          <PublicProfileHeader backHref="/" />
          <p className={styles.empty}>Sign in to view profiles.</p>
          <Link href="/login" className={styles.linkBtn}>
            Sign in
          </Link>
        </main>
        <GFBottomNav activeHref="/profile" />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <main className={styles.root}>
        <PublicProfileHeader backHref="/friends" />

        {loading ? <p className={styles.empty}>Loading…</p> : null}
        {error ? <p className={styles.bannerErr}>{error}</p> : null}

        {!loading && data ? (
          <>
            <div className={styles.hero}>
              <ProfileAvatar
                avatarUrl={data.avatarUrl}
                displayName={data.displayName}
                size="lg"
                className={styles.avatarWrap}
              />
              <h1 className={styles.displayName}>{data.displayName}</h1>
              <p className={styles.username}>@{data.username}</p>
              {data.bio.trim().length > 0 ? (
                <p className={styles.bio}>{data.bio}</p>
              ) : (
                <p className={styles.bioMuted}>No bio yet.</p>
              )}
              {isOwnProfile ? (
                <Link href="/profile" className={styles.editLink}>
                  Edit profile
                </Link>
              ) : null}
            </div>

            <ProfilePlaceholderSections />
          </>
        ) : null}

        <div className={styles.spacer} />
      </main>
      <GFBottomNav activeHref="/profile" />
    </div>
  );
}

function PublicProfileHeader({ backHref }: { backHref: string }) {
  return (
    <header className={styles.head}>
      <Link href={backHref} className={styles.back}>
        ← Back
      </Link>
      <p className={styles.brand}>GAMEFACE</p>
    </header>
  );
}
