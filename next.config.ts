import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";

// Version identity: build-info.json is written by `pnpm stamp` before deploys.
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const savedStamp = existsSync("build-info.json") ? JSON.parse(readFileSync("build-info.json", "utf8")) as { version: string; commit: string; builtAt: string } : null;
const stamp = savedStamp?.version === pkg.version ? savedStamp : null;

const nextConfig: NextConfig = {
  // Keep Turbopack's live development artifacts separate from production
  // builds so `next build` can never invalidate an open local session.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  devIndicators: false,
  env: {
    NEXT_PUBLIC_NYNZ_VERSION: stamp?.version || pkg.version,
    NEXT_PUBLIC_NYNZ_COMMIT: stamp?.commit || (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "unknown",
    NEXT_PUBLIC_NYNZ_BUILT_AT: stamp?.builtAt || "",
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
