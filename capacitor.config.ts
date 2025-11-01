import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennismate.app',
  appName: 'TennisMate',
  webDir: 'out',

  // Load your production PWA in the WebView
  server: {
    url: 'https://tennismate-s7vk.vercel.app/',
    cleartext: false,
  },

  android: {
    allowMixedContent: false,
  },

  // 🔽 Native splash configuration
  plugins: {
    SplashScreen: {
      // 0 lets Android 12+ decide; or use ~1200 for a consistent brief show
      launchShowDuration: 1200,
      launchAutoHide: true,

      // Set to your brand background color (swap this to your green if preferred)
      backgroundColor: '#0B132B', // e.g. try a brand green like '#16A34A'

      // Keep the logo crisp and centered (from assets/splash.png)
      androidScaleType: 'CENTER_INSIDE',

      // No spinner—clean look
      showSpinner: false,
    },
  },
};

export default config;
