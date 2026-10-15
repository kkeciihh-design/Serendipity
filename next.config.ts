import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A 10MB image expands to ~13.34MB when encoded in the guarded JSON API.
  experimental: { proxyClientMaxBodySize: "15mb" },
  serverExternalPackages: ["@prisma/client", "tesseract.js", "sharp", "@tesseract.js-data/chi_sim"],
};

export default nextConfig;
