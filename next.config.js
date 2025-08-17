// next.config.js
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development", // disables PWA in dev mode
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // ✅ add all remote hosts you serve images from
    domains: [
      "firebasestorage.googleapis.com",
      "tennismate-s7vk.vercel.app",     // <-- add this for your default avatar absolute URL
      "lh3.googleusercontent.com",      // <-- add this if you show Google profile photos
    ],
    // If you prefer path-scoped rules, you can use remotePatterns instead of domains.
    // remotePatterns: [
    //   { protocol: "https", hostname: "tennismate-s7vk.vercel.app", pathname: "/images/**" },
    //   { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/**" },
    //   { protocol: "https", hostname: "firebasestorage.googleapis.com", pathname: "/**" },
    // ],
  },
};

module.exports = withPWA(nextConfig);
