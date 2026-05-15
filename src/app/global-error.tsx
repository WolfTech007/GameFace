"use client";

/**
 * Root-level error boundary. Turbopack can omit default wired manifests for the built-in
 * global-error — defining one explicitly avoids intermittent client-manifest crashes.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ padding: 24, fontFamily: "system-ui, sans-serif", background: "#06060c", color: "#e5e7eb" }}>
        <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
        <p style={{ opacity: 0.85 }}>{error.message || "Unexpected error"}</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 16,
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
