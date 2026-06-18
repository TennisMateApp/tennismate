const {
  cleanUid,
  derivePairFromCommonFields,
  runRelationshipBackfill,
} = require("./relationshipBackfillCommon");

runRelationshipBackfill({
  collection: "match_invites",
  interactionType: "match_invite",
  latestRefField: "latestMatchInviteId",
  actorId: (data) => cleanUid(data.fromUserId) || cleanUid(data.senderId) || null,
  derivePlayers: async (data) =>
    derivePairFromCommonFields(data, [
      ["fromUserId", "toUserId"],
      ["senderId", "receiverId"],
    ]),
}).catch((error) => {
  console.error("Backfill failed", error);
  process.exitCode = 1;
});
