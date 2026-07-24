# Activity Leaderboard Production Backfill Record

Execution date: 2026-07-19 12:54 AEST  
Project: `tennismate-d8acb`  
Ruleset: `839eef1f-320b-4a2a-a504-67a5006c7d87`  
Function revision: `normalizeactivityonmatchhistorywrite-00002-luw`  
Function region/trigger: `australia-southeast2`, `match_history/{matchHistoryId}`

## Validation and preview

Before deployment/write, 62 unit tests and 14 emulator scenarios passed, including authenticated and unauthenticated rules checks and the real dirty-month timestamp persistence path. Functions TypeScript compilation, targeted lint and `git diff --check` passed. Two production previews agreed at 37 sources, 36 creates, one update, zero unchanged and checksum `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`.

The production command used explicit `--write`, `--confirm-project`, the fresh `--confirm-checksum`, batch size 20 and the required typed confirmation. Confirmation values and raw document identifiers are not reproduced here beyond the approved project/checksum contract.

## Runs

Completed run: `activity-20260719025418-a2afd18007`  
Started: 2026-07-19T02:54:23.794Z  
Completed: 2026-07-19T02:54:30.066Z  
Processed/source count: 37/37  
Created/updated/unchanged/failed: 36/1/0/0  
Final cursor: present and privacy-verified; hash `00418eed5288d1ae`  
Checksum: `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`

Prior failed run `activity-20260719022359-a2afd18007` remains recorded as `FAILED`, with zero processed/created/updated/unchanged records, one failure, null cursor and no rollback entries. It failed before the first derived transaction committed due to incompatible Admin SDK sentinel prototypes. No manual repair or deletion was performed.

## Final derived state

- `activity_match_events`: 37 documents; 28 structurally eligible, nine ineligible, 21 scoring-eligible, three confirmed duplicate exclusions, four possible-duplicate events pending and zero canonical conflicts.
- `activity_duplicate_reviews`: five documents; three auto-resolved confirmed groups and two pending possible groups.
- `activity_duplicate_resolutions`: zero documents; no manual resolution was written or changed.
- `activity_recalculation_requests`: seven pending documents, for `2025-12` and `2026-02` through `2026-07`; diagnostics are bounded and deduplicated.
- `activity_backfill_runs`: one completed run and the separately preserved failed attempt.

The updated event is referenced only as `activity_match_events/#8e66a16349df9d2e`. Retained pre-run evidence proves its normalization version changed from 1 to 2 and its scoring eligibility changed from non-true to true. Final duplicate state is `NONE / NOT_REQUIRED / NOT_APPLICABLE`, with no survivor and no ineligibility reasons. The rollback manifest retained the previous stable checksum rather than a full before-image, so additional exact before/after fields cannot be reconstructed safely.

No unexpected delete occurred: the collection grew from one event to 37, and reconciliation found no missing or unexpected record.

## Reconciliation and monitoring

Full-history reconciliation found 37 exact matches, zero missing, zero unexpected, zero field mismatches, zero version mismatches, zero scoring-eligibility mismatches, zero duplicate-resolution mismatches and zero dirty-month mismatches. Expected and stored checksums match exactly.

No normalization trigger invocation occurred during the run, because the backfill did not modify `match_history`. Recent function logs contained no runtime errors and no raw source, event or duplicate-group identifier fields. Firestore data-access audit logs were not enabled/visible, so verification relied on run checkpoints, collection metadata, deterministic reconciliation and function logs.

## Artifacts, rollback and next phase

- Write manifest: `activity-backfill-production-write.json`.
- Post-run reconciliation: `activity-backfill-production-reconcile-post-run.json`.
- Rollback preparation: 36 privacy-safe created-event references and one updated-event reference with its previous stable checksum. No automatic rollback exists, and the updated before-image was not retained.

Phase 2 monthly aggregation implementation and testing may begin using only `eligibleForScoring`. Production points, aggregate or ranking writes require separate design validation and explicit authorization. No source record, manual duplicate resolution, scoring total, ranking, cleanup or rollback was written during this backfill.
