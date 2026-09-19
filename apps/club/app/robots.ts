import type { MetadataRoute } from "next";

/** Landing is public. The seed board and auth door stay off the index. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/demo", "/example", "/club", "/login", "/api/"],
    },
  };
}
