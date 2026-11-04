import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// Only the release number is public. The build stamp stays private.
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

const nextConfig: NextConfig = {
  // Keep Turbopack's live development artifacts separate from production
  // builds so `next build` can never invalidate an open local session.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  devIndicators: false,
  env: {
    NEXT_PUBLIC_NYNZ_VERSION: pkg.version,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.google.com',
      },
    ],
  },
};

export default nextConfig;
