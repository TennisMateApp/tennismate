// next.config.ts — updated to allow Firebase image domains
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: ["firebasestorage.googleapis.com"],
  },
};

export default nextConfig;
