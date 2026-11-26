import type { MetadataRoute } from "next";

/** Lets phones install the app to the home screen; it opens on My work. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Maintenance ERP",
    short_name: "Maintenance",
    description: "Work orders, assets and field work — also without a signal.",
    start_url: "/m",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a1526",
    theme_color: "#0a1526",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
