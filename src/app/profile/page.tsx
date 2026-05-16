"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GFButton, GFBottomNav } from "@/components/gameface";
import { ProfileAvatar } from "@/components/gameface/ProfileAvatar";
import { ProfilePlaceholderSections } from "@/components/gameface/ProfilePlaceholderSections";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { updateOwnProfile, uploadAvatarPhoto } from "@/lib/gameface/profilesClient";
import styles from "./page.module.css";

const BIO_MAX = 280;

function isSignedInProfile(username: string | undefined): boolean {
  if (!username) return false;
  return !username.startsWith("guest_");
}

export default function ProfilePage() {
  const router = useRouter();
  const { profile, refreshRemoteProfile, setProfile } = useGameFaceProfile();
  const signedIn = isSignedInProfile(profile.username);

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile.avatarUrl ?? null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(profile.displayName);
    setBio(profile.bio ?? "");
    setAvatarPreview(profile.avatarUrl ?? null);
  }, [profile.displayName, profile.bio, profile.avatarUrl]);

  const onPickPhoto = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setSuccess(null);
    e.target.value = "";
  }, []);

  const onSave = useCallback(async () => {
    if (!signedIn || !profile.userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      let avatarUrl: string | undefined;
      if (pendingFile) {
        avatarUrl = await uploadAvatarPhoto(pendingFile, profile.userId);
      }

      const updated = await updateOwnProfile({
        displayName,
        bio,
        avatarUrl: avatarUrl ?? undefined,
      });

      setProfile({
        displayName: updated.displayName,
        bio: updated.bio,
        avatarUrl: updated.avatarUrl ?? undefined,
      });
      await refreshRemoteProfile();
      setPendingFile(null);
      setAvatarPreview(updated.avatarUrl);
      setSuccess("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }, [
    signedIn,
    profile.userId,
    pendingFile,
    displayName,
    bio,
    setProfile,
    refreshRemoteProfile,
  ]);

  if (!signedIn) {
    return (
      <div className={styles.shell}>
        <main className={styles.root}>
          <ProfilePageHeader />
          <p className={styles.empty}>Sign in to edit your profile.</p>
          <GFButton variant="primary" type="button" onClick={() => router.push("/login?redirect=/profile")}>
            Sign in
          </GFButton>
        </main>
        <GFBottomNav activeHref="/profile" />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <main className={styles.root}>
        <ProfilePageHeader />

        {error ? <p className={styles.bannerErr}>{error}</p> : null}
        {success ? <p className={styles.bannerOk}>{success}</p> : null}

        <div className={styles.hero}>
          <ProfileAvatar
            avatarUrl={avatarPreview}
            displayName={displayName}
            size="lg"
            className={styles.avatarWrap}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className={styles.fileInput}
            onChange={onFileChange}
          />
          <GFButton variant="ghost" type="button" className={styles.photoBtn} onClick={onPickPhoto}>
            Change photo
          </GFButton>
          <Link href={`/profile/${profile.username}`} className={styles.viewPublic}>
            View public profile →
          </Link>
        </div>

        <section className={styles.formSection}>
          <label className={styles.label} htmlFor="display-name">
            Display name
          </label>
          <input
            id="display-name"
            className={styles.input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={48}
            autoComplete="name"
          />

          <label className={styles.label} htmlFor="bio">
            Bio
          </label>
          <textarea
            id="bio"
            className={styles.textarea}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={BIO_MAX}
            rows={4}
            placeholder="Tell people about yourself…"
          />
          <p className={styles.charCount}>
            {bio.length}/{BIO_MAX}
          </p>

          <GFButton
            variant="primary"
            type="button"
            className={styles.saveBtn}
            disabled={saving}
            onClick={() => void onSave()}
          >
            {saving ? "Saving…" : "Save changes"}
          </GFButton>
        </section>

        <ProfilePlaceholderSections />

        <div className={styles.spacer} />
      </main>
      <GFBottomNav activeHref="/profile" />
    </div>
  );
}

function ProfilePageHeader() {
  return (
    <header className={styles.head}>
      <Link href="/" className={styles.back}>
        ← Games
      </Link>
      <p className={styles.brand}>GAMEFACE</p>
      <h1 className={styles.pageTitle}>Edit profile</h1>
    </header>
  );
}
