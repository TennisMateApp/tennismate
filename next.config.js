// next.config.js
const defaultRuntimeCaching = require("next-pwa/cache");

const runtimeCaching = [
  {
    // Never serve old Next.js JS bundles from a stale runtime cache. The
    // precache already versions these assets by build id/hash, and network
    // first prevents real mobile PWAs from running an old app shell after deploy.
    urlPattern: /^https?:\/\/[^/]+\/_next\/static\/.+\.(?:js|css)$/i,
    handler: "NetworkFirst",
    options: {
      cacheName: "next-static-assets",
      networkTimeoutSeconds: 3,
      expiration: {
        maxEntries: 96,
        maxAgeSeconds: 60 * 60,
      },
    },
  },
  {
    urlPattern: /\/_next\/data\/.+\/.+\.json$/i,
    handler: "NetworkFirst",
    options: {
      cacheName: "next-data",
      networkTimeoutSeconds: 3,
      expiration: {
        maxEntries: 32,
        maxAgeSeconds: 60 * 60,
      },
    },
  },
  ...defaultRuntimeCaching.filter((entry) => {
    const pattern = entry.urlPattern?.toString?.() || "";
    return (
      !pattern.includes("(?:js)") &&
      !pattern.includes("(?:css|less)") &&
      !pattern.includes("_next\\/data")
    );
  }),
];

const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  runtimeCaching,
  disable: process.env.NODE_ENV === "development",
});

module.exports = withPWA({
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/workbox-:hash.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/firebase-messaging-sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },

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
