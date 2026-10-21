import type { NextConfig } from "next";

const buildDirectory = process.env.SERENDIPITY_BUILD_DIR && /^\.next-[a-z0-9-]+$/.test(process.env.SERENDIPITY_BUILD_DIR)
  ? process.env.SERENDIPITY_BUILD_DIR : ".next";

const nextConfig: NextConfig = {
  // Isolated verification must not replace a running instance's build files.
  distDir: buildDirectory,
  typescript: process.env.SERENDIPITY_DESKTOP_BUILD === "1"
    ? { tsconfigPath: `${buildDirectory}/cache/tsconfig.json` } : {},
  reactStrictMode: true,
  // Travel JSON is capped at 64 MiB; its guarded API also enforces a stream limit.
  experimental: { proxyClientMaxBodySize: "65mb" },
  serverExternalPackages: ["@prisma/client", "tesseract.js", "sharp", "@tesseract.js-data/chi_sim", "playwright", "playwright-core"],
  // Keep the established hash algorithm consistent across Windows builds.
  // Stale file snapshots are recovered by a cold retry in desktop-build.mjs;
  // changing the hash algorithm does not repair missing snapshot input.
  webpack: (config) => {
    if (process.env.SERENDIPITY_JS_HASH === "1" || process.platform === "win32") {
      config.output = { ...config.output, hashFunction: "md4" };
    }
    return config;
  },
};

export default nextConfig;
