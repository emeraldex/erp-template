import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with only the traced runtime deps, so the production
  // image doesn't need node_modules or a package manager.
  output: "standalone",
  // The monorepo has lockfiles above this app; pin the trace root explicitly or
  // Next guesses (and warns about) the wrong one.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
