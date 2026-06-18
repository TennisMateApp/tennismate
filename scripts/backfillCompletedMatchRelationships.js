const {
  cleanUid,
  derivePairFromCommonFields,
  pairFromMatchLookup,
  runRelationshipBackfill,
} = require("./relationshipBackfillCommon");

runRelationshipBackfill({
  collection: "completed_matches",
  interactionType: "completed_match",
  latestRefField: "latestCompletedMatchId",
  actorId: (data) => cleanUid(data.fromUserId) || cleanUid(data.senderId) || null,
  derivePlayers: async (data) =>
    derivePairFromCommonFields(data, [
      ["fromUserId", "toUserId"],
      ["senderId", "receiverId"],
    ]) || pairFromMatchLookup(cleanUid(data.matchId)),
}).catch((error) => {
  console.error("Backfill failed", error);
  process.exitCode = 1;
});
