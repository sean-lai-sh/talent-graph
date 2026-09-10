import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(demoDir, "..");

const nextConfig: NextConfig = {
  // The algorithm core lives one directory up. Trace and bundle it with the app.
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
