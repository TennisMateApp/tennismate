import { Capacitor } from '@capacitor/core';
export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => (isNative() ? Capacitor.getPlatform() : 'web');
