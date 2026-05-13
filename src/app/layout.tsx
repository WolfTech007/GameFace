import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { GameFaceProfileProvider } from "@/contexts/GameFaceProfileContext";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--gf-font-body",
});

/** Reference-style geometric wordmark + home header (used via `var(--gf-font-brand)`). */
const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--gf-font-brand",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GAMEFACE",
  description: "1v1 webcam social games — faces first.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className={inter.className}>
        <GameFaceProfileProvider>{children}</GameFaceProfileProvider>
      </body>
    </html>
  );
}
