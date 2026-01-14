// next.config.js
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

module.exports = withPWA({
  reactStrictMode: true,

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
      // ✅ allow images served from your Vercel domain (e.g. /images/default-avatar.jpg)
      {
        protocol: "https",
        hostname: "tennismate-s7vk.vercel.app",
        pathname: "/**",
      },
    ],
  },

  // ❌ DO NOT add: output: 'export'
  // ❌ DO NOT add: distDir: 'out'
});
