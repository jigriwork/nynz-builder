import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { informationDocuments } from "@/lib/public-information";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 0.3 },
    ...Object.keys(informationDocuments).map(slug=>({url:`${SITE_URL}/${slug}`,changeFrequency:"monthly" as const,priority:0.4})),
  ];
}
