import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated verification must not replace a running instance's build files.
  distDir: process.env.SERENDIPITY_BUILD_DIR && /^\.next-[a-z0-9-]+$/.test(process.env.SERENDIPITY_BUILD_DIR)
    ? process.env.SERENDIPITY_BUILD_DIR : ".next",
  reactStrictMode: true,
  // Travel JSON is capped at 64 MiB; its guarded API also enforces a stream limit.
  experimental: { proxyClientMaxBodySize: "65mb" },
  serverExternalPackages: ["@prisma/client", "tesseract.js", "sharp", "@tesseract.js-data/chi_sim", "playwright", "playwright-core"],
};

export default nextConfig;
