"use client";

import React from "react";
import { buildPrivateInviteUrl } from "@/lib/gameface/privateInviteClipboard";
import styles from "./PrivateInviteWaitModal.module.css";

export type PrivateInviteWaitModalProps = {
  gameTitle: string;
  /** Plain handle without @ (same as HUD `you.username`). */
  plainUsername: string;
  playPath: string;
  inviteCode: string;
  onCopy: () => void | Promise<void>;
  onCancel: () => void;
  onGoHome: () => void;
};

export function PrivateInviteWaitModal({
  gameTitle,
  plainUsername,
  playPath,
  inviteCode,
  onCopy,
  onCancel,
  onGoHome,
}: PrivateInviteWaitModalProps) {
  const handle = plainUsername.trim();
  const inviteUrl = buildPrivateInviteUrl(playPath, inviteCode);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-invite-wait-title"
    >
      <div className={styles.card}>
        <div id="private-invite-wait-title" className={styles.gameTitle}>
          {gameTitle}
        </div>
        <p className={styles.lineMuted}>
          Playing as <span className={styles.handle}>{handle ? `@${handle}` : "@···"}</span>
        </p>
        <p className={styles.lineWaiting}>Waiting for teammate…</p>
        <div className={styles.inviteBox} title={inviteUrl}>
          {inviteUrl}
        </div>
        <button type="button" className={styles.copyBtn} onClick={() => void onCopy()}>
          Copy Invite Link
        </button>
        <div className={styles.actions}>
          <button type="button" className={styles.btnGhost} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.btnGhost} onClick={onGoHome}>
            Go Home
          </button>
        </div>
      </div>
    </div>
  );
}
