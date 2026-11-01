import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

import { COOP_EXEMPTIONS, STATIC_SECURITY_HEADERS } from "./src/lib/http/security-headers";

const allowedDevOrigins = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address);

const nextConfig: NextConfig = {
  allowedDevOrigins,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  experimental: {
    optimizePackageImports: ["@chakra-ui/react", "lucide-react"],
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
