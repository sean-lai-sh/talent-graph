import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const clubDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(clubDir, "../..");

const nextConfig: NextConfig = {
  // Vercel Root Directory is apps/club. Trace from the repo root so ../../src
  // is included in the serverless bundle (do not set this to apps/club).
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
