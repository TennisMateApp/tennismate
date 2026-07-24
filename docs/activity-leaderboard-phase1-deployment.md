# Activity Leaderboard Phase 1 Production Deployment

Deployment started: 2026-07-13 14:05:59 AEST  
Firebase project: `tennismate-d8acb`

## Scope

- Function: `normalizeActivityOnMatchHistoryWrite`
- Region: `australia-southeast2`
- Trigger: `match_history/{matchHistoryId}`
- Function behavior: non-scoring normalization, duplicate review/resolution application, and dirty-month marking only.
- No points, monthly aggregates, rankings, badges, or notifications are calculated.

## Commands

```text
firebase deploy --only firestore:rules --project tennismate-d8acb
firebase deploy --only functions:normalizeActivityOnMatchHistoryWrite --project tennismate-d8acb
firebase deploy --only functions:default:normalizeActivityOnMatchHistoryWrite --project tennismate-d8acb
```

These commands exclude hosting, Storage, indexes, unrelated functions, backfill scripts, and manual resolution writes.

## Predeployment validation

- Activity Leaderboard unit tests: 54 passed.
- Firestore transaction/integration tests: 10 passed.
- Firestore security-rule tests: 2 passed.
- TypeScript compilation: passed.
- Targeted Activity Leaderboard lint: passed.
- `git diff --check`: passed.
- Active project: confirmed `tennismate-d8acb`.
- Rules diff: only deny-all Activity Leaderboard generated-collection rules.
- Function export diff: only `normalizeActivityOnMatchHistoryWrite`.
- Unrelated `public/sw.js`, audit reports, debug logs, and untracked files are outside deployment scope.

## Deployment results

- Firestore rules: deployed successfully as ruleset `14fa5cb6-2424-43b7-8b9d-1611a30dd8a9`.
- Rules compiler: successful; three pre-existing warnings were reported for the unrelated `conversationParticipant` helper.
- First function command: stopped before upload because Firebase also ran the unrelated `courtsuggestions` predeploy, which has existing CSS font declaration conflicts.
- Successful function command: `firebase deploy --only functions:default:normalizeActivityOnMatchHistoryWrite --project tennismate-d8acb`.
- Function deployment: successful; state `ACTIVE`, Gen 2, Node.js 22.
- Deployed revision: `normalizeactivityonmatchhistorywrite-00001-vej`.
- Postdeployment metadata: region and trigger path confirmed.
- Postdeployment logs: rollout and startup probe succeeded; no runtime errors or trigger executions observed.
- Deployment warnings: Firebase advised that `firebase-functions` is outdated and could not clean several already-missing container image packages. Function provisioning completed successfully.
- Natural production source write observed: yes. It returned HTTP 200 and produced an eligible July 2026 event plus a dirty-month request with no runtime error.
- Derived normalized event verified: yes. The Phase 1 trigger remains active.

## Known pending duplicate groups

- April 2026: one `POSSIBLE_SAME_MATCH` group.
- July 2026: one `POSSIBLE_SAME_MATCH` group.
- Neither group is resolved by this deployment.

## Monitoring checklist

- Observe several natural `match_history` creates and updates.
- Observe a natural `not_played` transition if one occurs.
- Check function error/retry logs and execution duration.
- Watch duplicate-review growth and canonical-collision warnings.
- Confirm dirty-month records remain bounded and deduplicated.
- Confirm logs contain no user IDs, names, raw match identifiers, conversations, or source payloads.

## First natural-write verification

- Exactly one deterministic normalized event exists.
- Source path, sorted pair, participant count, Melbourne month/week, and eligibility are correct.
- `scoreConfirmedByBoth` remains false.
- No profile data or exact location is copied.
- The corresponding dirty-month request is pending with bounded diagnostics.
- Normal events create no duplicate review; ambiguous events remain pending; collisions fail closed.

## Rollback readiness

Delete only the trigger:

```text
firebase functions:delete normalizeActivityOnMatchHistoryWrite --region australia-southeast2 --project tennismate-d8acb --force
```

Retain generated records for inspection unless removal is separately authorized. Firestore rules should normally remain because they only deny client access to server-generated collections. If rules themselves must be reverted, deploy the previously reviewed ruleset from the last known-good revision; do not loosen these collections ad hoc.

## Guarded backfill preparation

The next implementation adds preview-first write and read-only reconciliation modes to `scripts/backfillActivityMatchEvents.ts`. Production writes require explicit project/checksum arguments, ADC, exact active-project detection, a fresh source re-read, no emulator variables, no conflicts/newer versions, and an interactive typed confirmation. Write processing calls the same `normalizeAndPersistMatchHistoryWrite` transaction as this deployed trigger, uses deterministic source cursors, and checkpoints only after successful transactions. No production backfill or deployment was performed while preparing it.

Trigger structured logs are also prepared to replace raw source/canonical/group identifiers with deterministic 16-hex-character SHA-256 reference hashes. This logging correction is not deployed yet and must be included in a later controlled function deployment.

Two read-only production previews on 2026-07-19 were deterministic at 37 sources, 28 structurally eligible, nine ineligible, 21 scoring events, three excluded confirmed copies, four pending possible-duplicate events, and zero canonical conflicts. Full-history checksum: `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`. Two July previews were deterministic at three structurally eligible events, one scoring event and two pending events, checksum `77f59f1f5d902d88b4df79509b08e8acbfa3a7380c9f924a6510c7d5cca97e19`. The one-record/one-scoring-event increase is the observed natural production completion, not checksum drift.

Read-only reconciliation found the expected pre-backfill state: 36 missing historical events and one stored trigger-created event requiring deterministic normalization/scoring-state update; no unexpected derived events were present. This is a pre-write discrepancy report, not a production failure.

## Production backfill completion (2026-07-19)

The prepared Firestore rules were deployed as ruleset `839eef1f-320b-4a2a-a504-67a5006c7d87`, and the privacy-safe normalization function was deployed as active revision `normalizeactivityonmatchhistorywrite-00002-luw` in `australia-southeast2`. Its trigger remains `match_history/{matchHistoryId}` and the rollout startup probe succeeded.

Production run `activity-20260719025418-a2afd18007` completed with checksum `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`: 37 processed, 36 created, one deterministically updated, zero unchanged and zero failed. The prior timestamp-sentinel attempt `activity-20260719022359-a2afd18007` remains separately `FAILED` with zero processed records and no derived transaction committed.

Final state is 37 normalized events: 28 structurally eligible, nine ineligible, 21 scoring-eligible, three excluded confirmed duplicates, four possible-duplicate events pending review and zero canonical conflicts. Five duplicate reviews exist (three auto-resolved and two pending); no manual duplicate-resolution document was written. Dirty requests exist only for `2025-12` and `2026-02` through `2026-07`, all pending with bounded, deduplicated diagnostics.

Read-only reconciliation produced 37 exact matches and zero missing, unexpected, field, version, scoring-eligibility, duplicate-resolution or dirty-month mismatches. Expected and stored checksums match. No normalization trigger invocation occurred during the backfill because no source document was changed; recent function logs contained no runtime errors or raw identifier fields. Firestore data-access audit logs were unavailable. Phase 2 implementation and testing may begin against `eligibleForScoring`; any production aggregation deployment remains separately authorized work.
