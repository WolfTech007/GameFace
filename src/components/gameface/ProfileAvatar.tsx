"use client";

import styles from "./ProfileAvatar.module.css";

export type ProfileAvatarProps = {
  avatarUrl?: string | null;
  displayName?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function ProfileAvatar({
  avatarUrl,
  displayName,
  size = "md",
  className,
}: ProfileAvatarProps) {
  const sizeClass =
    size === "lg" ? styles.lg : size === "sm" ? styles.sm : styles.md;
  const initial =
    displayName?.trim().charAt(0).toUpperCase() ||
    "?";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${styles.img} ${sizeClass} ${className ?? ""}`}
      />
    );
  }

  return (
    <div
      className={`${styles.fallback} ${sizeClass} ${className ?? ""}`}
      aria-hidden
    >
      {initial}
    </div>
  );
}
