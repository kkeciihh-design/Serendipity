import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolated verification must not replace a running instance's build files.
  distDir: process.env.SERENDIPITY_BUILD_DIR && /^\.next-[a-z0-9-]+$/.test(process.env.SERENDIPITY_BUILD_DIR)
    ? process.env.SERENDIPITY_BUILD_DIR : ".next",
  reactStrictMode: true,
  // A 10MB image expands to ~13.34MB when encoded in the guarded JSON API.
  experimental: { proxyClientMaxBodySize: "15mb" },
  serverExternalPackages: ["@prisma/client", "tesseract.js", "sharp", "@tesseract.js-data/chi_sim"],
};

export default nextConfig;
