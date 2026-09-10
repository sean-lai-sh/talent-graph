import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { convexConfigured } from "./convexEnv.ts";

type AuthServer = ReturnType<typeof convexBetterAuthNextJs>;

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
const configured = convexConfigured(convexUrl, convexSiteUrl);

const authServer = configured ? convexBetterAuthNextJs({ convexUrl, convexSiteUrl }) : null;

function unconfigured(): Response {
  return new Response("Convex + Better Auth is not configured for /club", { status: 503 });
}

export const handler = authServer?.handler ?? {
  GET: async () => unconfigured(),
  POST: async () => unconfigured(),
};

export const getToken = authServer?.getToken ?? (async () => undefined);
export const isAuthenticated = authServer?.isAuthenticated ?? (async () => false);

const notConfigured = async () => {
  throw new Error("Convex + Better Auth is not configured for /club");
};

export const preloadAuthQuery = (authServer?.preloadAuthQuery ??
  notConfigured) as AuthServer["preloadAuthQuery"];
export const fetchAuthQuery = (authServer?.fetchAuthQuery ??
  notConfigured) as AuthServer["fetchAuthQuery"];
export const fetchAuthMutation = (authServer?.fetchAuthMutation ??
  notConfigured) as AuthServer["fetchAuthMutation"];
export const fetchAuthAction = (authServer?.fetchAuthAction ??
  notConfigured) as AuthServer["fetchAuthAction"];
