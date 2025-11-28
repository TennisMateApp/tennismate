import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennismate.app',
  appName: 'TennisMate',
  webDir: 'out',

  server: {
    url: 'https://tennismate-s7vk.vercel.app',
    cleartext: false,
    allowNavigation: ['tennismate-s7vk.vercel.app'],
  },

  ios: {
    // 👇 This tells Capacitor to actually use App-Bound Domains for this WKWebView
    limitsNavigationsToAppBoundDomains: true,
  },

  android: {
    allowMixedContent: false,
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
      overlaysWebView: false,
      style: 'DARK',
    },
  },
};

export default config;
