export type PushDeviceRecord = {
  notificationsEnabled?: unknown;
  pushOptOut?: unknown;
  revoked?: unknown;
};

/**
 * Checks a stored device's notification preferences.
 * @param {PushDeviceRecord} device Stored device preference fields.
 * @return {boolean} Whether push delivery may be attempted.
 */
export function isPushDeviceEligible(device: PushDeviceRecord): boolean {
  return device.notificationsEnabled !== false &&
    device.pushOptOut !== true &&
    device.revoked !== true;
}
