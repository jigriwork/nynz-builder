import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NYNZ", short_name: "NYNZ", description: "Build real web apps from a brief.", start_url: "/dashboard", display: "standalone",
    background_color: "#070b12", theme_color: "#070b12", icons: [{ src: "/icon.png", sizes: "any", type: "image/png" }, { src: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  };
}
