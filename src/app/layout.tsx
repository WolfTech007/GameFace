import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { GameFaceProfileProvider } from "@/contexts/GameFaceProfileContext";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--gf-font-body",
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
    <html lang="en" className={inter.variable}>
      <body className={inter.className}>
        <GameFaceProfileProvider>{children}</GameFaceProfileProvider>
      </body>
    </html>
  );
}
