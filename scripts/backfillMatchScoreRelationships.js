const {
  runRelationshipBackfill,
  validPair,
} = require("./relationshipBackfillCommon");

runRelationshipBackfill({
  collection: "match_scores",
  interactionType: "match_score",
  latestRefField: "latestScoreId",
  derivePlayers: async (data) => validPair(data.players) || validPair(data.participants),
}).catch((error) => {
  console.error("Backfill failed", error);
  process.exitCode = 1;
});
