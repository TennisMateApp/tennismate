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
    domains: ["firebasestorage.googleapis.com"],
  },
  // ❌ DO NOT add: output: 'export'
  // ❌ DO NOT add: distDir: 'out'
});
