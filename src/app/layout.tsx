import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { PwaRegistration } from "@/components/pwa/pwa-registration";
import { Provider } from "@/components/ui/provider";
import { BRAND } from "@/lib/brand";

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
    default: BRAND.name,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND.name,
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  themeColor: "#F4F3EE",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
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
