import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennismate.app',            // <- keep this consistent everywhere
  appName: 'TennisMate',
  webDir: 'out',

  // Load your production PWA in the WebView
  server: {
    // Prefer your stable custom domain over a Vercel preview URL
    url: 'https://tennis-match.com.au',    // or keep your vercel.app if needed
    cleartext: false,
    allowNavigation: [
      'tennis-match.com.au',
      'tennismate-s7vk.vercel.app',       // keep if you sometimes point there
      '*.googleapis.com',                  // if you open these in-app
      '*.firebaseapp.com',
      '*.vercel.app'
    ],
  },

  ios: {
    // feels nicer with safe area handling; optional
    contentInset: 'always',
    allowsLinkPreview: true
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
  },
};

export default config;
