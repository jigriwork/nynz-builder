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
  // Security headers for NYNZ's own pages. Previews and published sites are
  // served by the separate preview host, which sets its own headers; the
  // builder may still frame them because frame-src is not restricted here.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://api.razorpay.com https://checkout.razorpay.com" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")" },
      ],
    }];
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
