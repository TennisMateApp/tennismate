import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tennismate.app',
  appName: 'TennisMate',
  webDir: 'out',
  server: {
    // 🔁 Use your live prod URL so the app always loads latest deploy
    url: 'https://tennismate-s7vk.vercel.app/',
    cleartext: false,
  },
  android: { allowMixedContent: false },
};

export default config;