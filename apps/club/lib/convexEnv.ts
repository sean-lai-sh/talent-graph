/**
 * One predicate for Convex + Better Auth on /club.
 * Site URL must be *.convex.site — parseConvexSiteUrl rejects .convex.cloud.
 */
export function convexConfigured(
  url: string = process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
  siteUrl: string = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "",
): boolean {
  return Boolean(url && siteUrl.endsWith(".convex.site"));
}
