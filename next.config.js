// next.config.js
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development", // disables PWA in dev
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // For static export + Capacitor
  output: "export",

  images: {
    domains: ["firebasestorage.googleapis.com"],
    // Required for static export so Next.js doesn't rely on the image optimizer
    unoptimized: true,
  },
};

module.exports = withPWA(nextConfig);
