/* eslint-disable max-len */
import * as admin from "firebase-admin";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {MatchHistorySource} from "./types";
import {normalizeAndPersistMatchHistoryWrite} from "./persistence";
import {activityPersistenceLog, privacySafeRefHash} from "./privacyLogging";

export const normalizeActivityOnMatchHistoryWrite = onDocumentWritten(
  {document: "match_history/{matchHistoryId}", region: "australia-southeast2"},
  async (change) => {
    const sourceDocumentId = change.params.matchHistoryId;
    try {
      const result = await normalizeAndPersistMatchHistoryWrite(admin.firestore(), {
        sourceDocumentId,
        before: change.data?.before.exists ? change.data.before.data() as MatchHistorySource : null,
        after: change.data?.after.exists ? change.data.after.data() as MatchHistorySource : null,
      });
      console.log("[activity_leaderboard] normalization persisted", activityPersistenceLog(result));
    } catch (error) {
      console.error("[activity_leaderboard] normalization failed", {sourceRefHash: privacySafeRefHash(sourceDocumentId), errorCategory: error instanceof Error ? error.name : "UNKNOWN"});
      throw error;
    }
  }
);
