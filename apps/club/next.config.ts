import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const clubDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(clubDir, "../..");

const nextConfig: NextConfig = {
  // Vercel Root Directory is apps/club. Trace from the repo root so ../../src
  // is included in the serverless bundle (do not set this to apps/club).
  outputFileTracingRoot: repoRoot,
  // verify-club sets NEXT_DIST_DIR so it does not share apps/club/.next with
  // a developer `next dev` on :3000. Unset, this is the Next default.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
