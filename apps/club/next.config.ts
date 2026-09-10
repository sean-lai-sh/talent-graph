import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const clubDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(clubDir, "../..");

const nextConfig: NextConfig = {
  // The algorithm core lives two directories up. Trace and bundle it with the app.
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
