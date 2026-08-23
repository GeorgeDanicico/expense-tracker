import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Simple Ledger Expense Tracker",
    short_name: "Simple Ledger",
    description: "A private, straightforward monthly expense tracker.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7f6f2",
    theme_color: "#f7f6f2",
    orientation: "any",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
