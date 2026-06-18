const {
  runRelationshipBackfill,
  validPair,
} = require("./relationshipBackfillCommon");

runRelationshipBackfill({
  collection: "conversations",
  interactionType: "conversation",
  latestRefField: "latestConversationId",
  derivePlayers: async (data) => validPair(data.participants),
}).catch((error) => {
  console.error("Backfill failed", error);
  process.exitCode = 1;
});
