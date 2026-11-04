import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Public marketing pages are indexable; product, account and admin routes are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/pricing", "/login"], disallow: ["/api/", "/admin", "/dashboard", "/projects", "/billing", "/account", "/auth", "/reset-password", "/forgot-password", "/suspended", "/design", "/builder", "/generation"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
