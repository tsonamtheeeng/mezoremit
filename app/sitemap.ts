import type { MetadataRoute } from "next";
import { SITE } from "@/lib/client/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE.url}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/help`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];
}
