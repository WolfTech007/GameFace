"use client";

import React from "react";
import styles from "./GFButton.module.css";

export type GFButtonVariant = "primary" | "ghost" | "danger";

export type GFButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GFButtonVariant;
};

export function GFButton({ variant = "primary", className, ...rest }: GFButtonProps) {
  const v =
    variant === "ghost" ? styles.ghost : variant === "danger" ? styles.danger : styles.primary;
  return <button type="button" className={`${styles.btn} ${v} ${className ?? ""}`} {...rest} />;
}
