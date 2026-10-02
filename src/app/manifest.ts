import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Simple Ledger Expense Tracker",
    short_name: "Simple Ledger",
    description: "A private, modern expense tracker that makes spending easy to understand.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#F4F3EE",
    theme_color: "#F4F3EE",
    orientation: "any",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
