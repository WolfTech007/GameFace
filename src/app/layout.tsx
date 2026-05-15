import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter, Orbitron, Outfit } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
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

/** Thick display caps for game titles (home cards). */
const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--gf-font-display",
});

/** Sci-fi headline for Quick match CTA. */
const orbitron = Orbitron({
  subsets: ["latin"],
  display: "swap",
  variable: "--gf-font-sci",
  weight: ["600", "700", "800", "900"],
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
  themeColor: "#06060c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} ${bebasNeue.variable} ${orbitron.variable}`}>
      <body className={inter.className}>
        <AuthProvider>
          <GameFaceProfileProvider>{children}</GameFaceProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
