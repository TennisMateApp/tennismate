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

    ios: {
    appBoundDomains: ['tennismate-s7vk.vercel.app'],
  },
  
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0B132B',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false, // 👈 this is the key line
      style: 'DARK',
    },
  },
};

export default config;
