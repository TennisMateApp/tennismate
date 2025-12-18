import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennismate.app',
  appName: 'TennisMate',
  webDir: 'out',

  server: {
    // ✅ point to your deployed PWA URL — no trailing slash
    url: 'https://tennismate-s7vk.vercel.app',
    cleartext: false,
    allowNavigation: ['tennismate-s7vk.vercel.app'],
  },

  android: {
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
    },

    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
    },

    // ✅ REQUIRED so TypeScript + Vercel build passes
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId:
        '16871894453-pq6n70u7remnbu2pmdjf98jcshdr8geu.apps.googleusercontent.com',
      forceCodeForRefreshToken: false,
    },
  },
};

export default config;
