import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "rexMaps",
  description: "Personal backcountry mapping — routes, layers, research",
  appleWebApp: { title: "rexMaps", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#047857",
  // The map's own pinch/double-tap zoom (MapLibre's internal touch
  // handlers) is independent of the browser's native page zoom — without
  // this, a pinch on the map also zooms the whole page, shoving the
  // toolbar/panels out of the viewport. This only disables the browser's
  // page-level zoom; MapLibre's gestures on the map canvas are unaffected.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Browser extensions inject attributes into <html> (e.g.
      // data-js-focus-visible) before hydration; only this element is exempted.
      suppressHydrationWarning
    >
      <body className="h-dvh overflow-hidden overscroll-none">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
