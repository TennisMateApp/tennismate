# Activity Leaderboard Normalized-Event Backfill Runbook

This runbook covers only the derived Phase 1 collections. It does not calculate points, monthly aggregates, rankings, badges, notifications, or modify `match_history`.

## Absolute safety rule

**Production write mode must not be run without explicit approval.** Preview and reconciliation are read-only. Never delete production source data or derived Activity Leaderboard documents as part of this procedure.

## Preview

Run from `functions` with Application Default Credentials (ADC) for the intended project:

```powershell
npm run backfill:activity-match-events -- --output=../activity-backfill-preview.json
npm run backfill:activity-match-events -- --month=2026-07 --output=../activity-backfill-preview-2026-07.json
```

Spaced forms are also accepted, for example `--month 2026-07 --limit 100`. The command must print `MODE: READ_ONLY` and the active project. A preview writes no checkpoints or Firestore documents. Review creates, updates, unchanged records, conflicts, pending events, dirty months, versions, source watermark, checksum, and failures. The current pre-natural-write reference values are 36 sources, 27 structurally eligible, nine ineligible, 20 scoring survivors, three excluded confirmed copies, four pending possible-duplicate events, checksum `622f3f48497776a2ebe92104e8381febb62e218d545e25df396ad48c3b9639da`; July is checksum `2e1144d4fcdb4e521cb5c34047cc32a4bc4ac84d385fb9eede8066bc2637ce4c`. A natural source write may legitimately change these values; require two identical fresh previews rather than forcing an old checksum.

## Production write template

After separate approval, use the checksum from the immediately preceding preview:

```powershell
npx tsx ../scripts/backfillActivityMatchEvents.ts --write --confirm-project=tennismate-d8acb --confirm-checksum=<64-character-preview-checksum> --batch-size=20 --output=../activity-backfill-write.json
```

Run this from `functions`. Direct `tsx` invocation is deliberate: npm's Windows PowerShell shim may consume boolean options. The CLI never infers `--write` from `npm_config_write`, even when that environment variable is present.

The command refuses missing confirmations, the wrong/unknown project, malformed or stale checksums, emulator variables, non-interactive terminals, ambiguous arguments, canonical conflicts, and unsupported newer stored versions. It validates ADC, re-reads source and stored state, recomputes the checksum, prints the plan, then requires typing `tennismate-d8acb WRITE`. There is intentionally no non-interactive write option.

## Monitoring, interruption, and resume

Write runs create server-only `activity_backfill_runs/{runId}` metadata after all confirmations. Monitor status, counts, `lastProcessedCursor`, timestamps, and categorized error only; metadata contains no source payloads or participant IDs. Source records are ordered by document ID, processed in bounded chunks, and each source uses the production normalization transaction. The checkpoint advances only after that transaction succeeds. Transient failures retry at most three times.

If interrupted, record the run ID and its `lastProcessedCursor`, investigate the failure, run a new preview, obtain fresh approval/checksum if required, and resume with `--resume-from=<lastProcessedCursor>`. Retrying the same source is idempotent. Canonical conflicts and newer-version records stop the run and must be investigated; never work around them by overwriting or deleting data.

## Post-write reconciliation

```powershell
npx tsx ../scripts/backfillActivityMatchEvents.ts --reconcile --output=../activity-backfill-reconcile.json
npx tsx ../scripts/backfillActivityMatchEvents.ts --reconcile --month=2026-07 --output=../activity-backfill-reconcile-2026-07.json
```

Reconciliation is read-only and compares expected events, duplicate reviews, scoring eligibility, dirty months, versions, and checksums with stored state. Missing, unexpected, mismatched, stale-review, resolution, eligibility, and version counts must be investigated before declaring success.

## Failure and rollback preparation

On failure, leave the trigger active, preserve the failed run and derived documents, capture the manifest, and stop. Do not delete source data. Write manifests include privacy-safe reference hashes, whether each touched event was created or requires restoration, and a previous-state checksum. Automatic rollback is not implemented. A future `--rollback-run=<runId>` command must be preview-only first, resolve and validate every reference, retain previous document snapshots, and require a separate destructive approval before it can restore or delete anything.

No cleanup mode exists. A future cleanup command must be isolated from backfill, preview-first, and separately confirmed; stale/orphaned documents are report-only today.

## 2026-07-19 production execution record

The authorized production run `activity-20260719025418-a2afd18007` completed from 2026-07-19 02:54:23.794Z to 02:54:30.066Z (12:54:23.794–12:54:30.066 AEST). It used batch size 20 and checksum `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`. All 37 sources were processed: 36 event documents were created, one existing v1 event was deterministically updated to v2, none were unchanged, and no failures or deletes occurred.

The immediately preceding attempt, `activity-20260719022359-a2afd18007`, remains recorded as `FAILED`. It failed before its first source transaction committed because the CLI and persistence code had resolved different installed Admin SDK versions and therefore incompatible server-timestamp sentinel prototypes. Its checkpoint shows zero processed/created/updated/unchanged records, one failure, null cursor and no rollback entries. The corrected CLI and persistence path share the Functions-owned `firebase-admin/firestore` exports; emulator coverage verifies `requestedAt` is stored as an Admin `Timestamp` and preserved on retry.

Post-run reconciliation matched all 37 events exactly: zero missing, unexpected, field, version, eligibility, duplicate-resolution or dirty-month mismatches. Expected and stored checksums both equal the approved checksum. Production contains 21 scoring-eligible events, three confirmed duplicate exclusions, four possible-duplicate events pending review, nine structurally ineligible events and zero canonical conflicts. The seven dirty-month documents are `2025-12` and `2026-02` through `2026-07`; all are pending, bounded and deduplicated.

Rollback preparation is available in `activity-backfill-production-write.json`: 36 privacy-safe create references and one update reference with its previous stable checksum. The prior update snapshot was not retained, so a later rollback tool cannot restore that event from the checksum alone. Automatic rollback and cleanup remain prohibited. Firestore data-access audit logs were not enabled/visible for this run; verification used run metadata, collection state, deterministic reconciliation and function logs.
