/**
 * One predicate for Convex + Better Auth on /club and /members.
 * A cloud site URL must be *.convex.site. `.convex.cloud` is the API host.
 * A loopback pair is a throwaway local backend, both URLs on this machine.
 */
function loopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

export function convexConfigured(
  url: string = process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
  siteUrl: string = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "",
): boolean {
  if (!url || !siteUrl || siteUrl.endsWith(".convex.cloud")) return false;
  if (siteUrl.endsWith(".convex.site")) return true;
  return loopbackUrl(url) && loopbackUrl(siteUrl);
}
