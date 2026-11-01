import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";

import { PwaRegistration } from "@/components/pwa/pwa-registration";
import { Provider } from "@/components/ui/provider";
import { BRAND } from "@/lib/brand";
import { NONCE_HEADER } from "@/lib/http/csp";

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

/**
 * Reads the request's CSP nonce (set by `src/proxy.ts`) for next-themes' inline script; Next puts
 * it on its own scripts by itself. Reading a request header renders every page per request, which
 * a nonce needs anyway: a page rendered at build time can't carry the nonce of a later request.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Provider nonce={nonce}>{children}</Provider>
        <PwaRegistration />
      </body>
    </html>
  );
}
