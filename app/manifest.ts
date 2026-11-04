import type { MetadataRoute } from "next";

/** Install metadata: NYNZ can be added to the home screen or installed as a desktop app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "NYNZ",
    short_name: "NYNZ",
    description: "Describe your app and NYNZ builds a working web app.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#070b12",
    theme_color: "#070b12",
    categories: ["productivity", "developer", "business"],
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
