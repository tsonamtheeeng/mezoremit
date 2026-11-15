import type { MetadataRoute } from "next";
import { SITE } from "@/lib/client/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/claim/", "/dashboard", "/send", "/transfers/", "/received", "/history", "/recipients", "/payouts/", "/settings", "/notifications", "/signin"],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
