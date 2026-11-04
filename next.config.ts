import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

import { legacyRedirects } from "./src/lib/http/legacy-redirects";
import { COOP_EXEMPTIONS, STATIC_SECURITY_HEADERS } from "./src/lib/http/security-headers";

const allowedDevOrigins = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address);

/**
 * The commit this build is from, for the browser to send with its error reports (logging plan, L7) so
 * a stack can be matched to a build. `GIT_SHA` is set by CI and `scripts/deploy.sh` (see the
 * Dockerfile); only a commit hash is passed on, anything else (or nothing) becomes empty. It's public
 * by design: it goes into the bundle every visitor downloads.
 */
const release = /^[A-Za-z0-9]{1,64}$/.test(process.env.GIT_SHA ?? "") ? (process.env.GIT_SHA as string) : "";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_RELEASE: release },
  allowedDevOrigins,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  experimental: {
    optimizePackageImports: ["@chakra-ui/react", "lucide-react"],
  },
  async redirects() {
    return legacyRedirects();
  },
  async headers() {
    // Evaluated once, at build time: what depends on the request or on runtime env (the CSP and
    // HSTS) is set in src/proxy.ts instead.
    return [
      {
        source: "/:path*",
        headers: [...STATIC_SECURITY_HEADERS],
      },
      ...Object.keys(COOP_EXEMPTIONS).map((source) => ({
        source,
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }],
      })),
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
