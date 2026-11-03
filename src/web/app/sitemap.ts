import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_NOINDEX, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  if (SITE_NOINDEX) return [];
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, SITE_URL).toString() }));
}
