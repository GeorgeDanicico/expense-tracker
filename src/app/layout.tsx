import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { PwaRegistration } from "@/components/pwa/pwa-registration";
import { Provider } from "@/components/ui/provider";

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
  title: {
    default: "Simple Ledger",
    template: "%s · Simple Ledger",
  },
  description: "A private, straightforward monthly expense tracker.",
  applicationName: "Simple Ledger",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Simple Ledger",
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  themeColor: "#f7f6f2",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Provider>{children}</Provider>
        <PwaRegistration />
      </body>
    </html>
  );
}
