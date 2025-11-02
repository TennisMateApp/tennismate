import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennismate.app',
  appName: 'TennisMate',
  webDir: 'out',

  // Load your production PWA in the WebView
  server: {
    // ✅ point to your stable production URL and remove trailing slash
    url: 'https://tennismate-s7vk.vercel.app', 
    cleartext: false,
    // (Optional) allow navigation to this host (and any others you may bounce to)
    allowNavigation: ['tennismate-s7vk.vercel.app'],
  },

  android: {
    // Keep this false unless you knowingly load http assets
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      // You can drop to 600–800 for a snappier feel if you like
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0B132B',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
    },
  },
};

export default config;
