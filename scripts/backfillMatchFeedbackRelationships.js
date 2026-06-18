const {
  cleanUid,
  derivePairFromCommonFields,
  pairFromMatchLookup,
  runRelationshipBackfill,
} = require("./relationshipBackfillCommon");

runRelationshipBackfill({
  collection: "match_feedback",
  interactionType: "match_feedback",
  latestRefField: "latestFeedbackId",
  actorId: (data) => cleanUid(data.userId) || cleanUid(data.fromUserId) || cleanUid(data.senderId) || null,
  derivePlayers: async (data) =>
    derivePairFromCommonFields(data, [
      ["fromUserId", "toUserId"],
      ["senderId", "receiverId"],
    ]) || pairFromMatchLookup(cleanUid(data.matchId)),
}).catch((error) => {
  console.error("Backfill failed", error);
  process.exitCode = 1;
});
