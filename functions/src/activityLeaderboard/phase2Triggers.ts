import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineBoolean} from "firebase-functions/params";
import {admin} from "./adminSdk";
import {
  cleanupRetiredActivityGenerations,
  processPendingActivityMonths,
} from "./monthlyRecalculation";

export const activityPhase2Enabled = defineBoolean(
  "ACTIVITY_PHASE2_ENABLED",
  {default: false}
);

const scheduleOptions = {
  schedule: "every 15 minutes",
  timeZone: "Australia/Sydney",
  region: "australia-southeast1",
  maxInstances: 1,
};

export const recalculateDirtyActivityMonths = onSchedule(
  scheduleOptions,
  async () => {
    if (!activityPhase2Enabled.value()) return;
    await processPendingActivityMonths(admin.firestore());
  }
);

export const cleanupRetiredActivityGenerationsScheduled = onSchedule(
  {...scheduleOptions, schedule: "every day 03:30"},
  async () => {
    if (!activityPhase2Enabled.value()) return;
    await cleanupRetiredActivityGenerations(admin.firestore());
  }
);
