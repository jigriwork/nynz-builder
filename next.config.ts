import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack's live development artifacts separate from production
  // builds so `next build` can never invalidate an open local session.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  devIndicators: false,
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
