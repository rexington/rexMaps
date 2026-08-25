import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
      <body className="h-dvh overflow-hidden overscroll-none">{children}</body>
    </html>
  );
}
