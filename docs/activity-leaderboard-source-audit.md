# TennisMate Activity Leaderboard Production Source Audit

Audit date: 2026-07-12  
Firebase project: `tennismate-d8acb`  
Reports analysed: `activity-audit-2026-07.json`, `activity-audit-all.json`  
Audit mode: read-only

## Executive conclusion

The full audit scanned 36 `match_history` documents. Twenty-seven (75.0%) satisfy the Phase 1 normalization rules and nine (25.0%) are ineligible. The nine exclusions are internally consistent `not_played` records: every one is also not completed and has no activity date. No malformed participant records, self matches, invalid dates, completed/not-played conflicts, cross-month date disagreements, or canonical-ID collisions were found.

The only material blocker is duplicate handling. The audit found two duplicate logical-match occurrences across full history, including one in July. Because canonical-ID duplicates are zero, these candidates have distinct canonical IDs and would produce multiple normalized events rather than overwrite one event. If both candidates represent accidental duplicate submissions, the current 27 eligible events overstate activity by up to two matches (four player activity entries). The aggregate report cannot prove whether these are retries or legitimate same-pair matches on the same day, so automatic deletion based only on this heuristic is unsafe.

Recommendation: the normalization trigger may be deployed after adding collision/duplicate observability and tests because it does not award points and preserves source-derived events. Do not run a historical backfill or begin production Phase 2 aggregation until the two logical duplicate occurrences are classified and a deterministic deduplication policy is implemented.

## Safety and completeness

Both reports declare `mode: "READ_ONLY"`. No deployment, backfill, normalized-event write, or production mutation was performed during this analysis. Production Firestore was not queried again.

The reports are complete for the collection snapshot taken on 2026-07-12:

- both have `limit: null`;
- both scanned 36 source documents;
- the full report included all 36;
- the July report included two records whose derived month is `2026-07`;
- full-history monthly eligible counts sum to 27, matching `eligibleRecords`.

## Full-history results

| Metric | Count | Percentage of 36 source records |
|---|---:|---:|
| Source documents scanned/included | 36 | 100.0% |
| Eligible normalized matches | 27 | 75.0% |
| Ineligible records | 9 | 25.0% |
| Using `playedDate` | 10 | 27.8% |
| Falling back to `completedAt` | 17 | 47.2% |
| Missing activity date | 9 | 25.0% |
| Invalid activity date | 0 | 0.0% |
| Invalid participant count | 0 | 0.0% |
| Self match | 0 | 0.0% |
| Completed and also `not_played` | 0 | 0.0% |
| Cross-month date disagreement | 0 | 0.0% |
| Duplicate canonical event IDs | 0 | 0.0% |
| Duplicate logical-match occurrences | 2 | 5.6% |

All 27 eligible records have a usable date: 10 use `playedDate` (37.0% of eligible records) and 17 use `completedAt` (63.0% of eligible records). The date-source percentages in the table use all 36 source records so they reconcile with the nine undated exclusions.

### Every ineligibility reason

| Reason | Count | Classification | Recommendation |
|---|---:|---|---|
| `NOT_COMPLETED` | 9 | Expected | Remain excluded. These are the same explicit no-match records described below. |
| `NOT_PLAYED` | 9 | Expected | Remain excluded permanently; no tennis activity occurred. |
| `MISSING_ACTIVITY_DATE` | 9 | Expected for `not_played` | Remain excluded. Do not invent or migrate a date for a no-match outcome. |
| `INVALID_ACTIVITY_DATE` | 0 | Not observed | Continue excluding if encountered; allow only a narrowly tested legacy parser if evidence later requires it. |
| `INVALID_PARTICIPANT_COUNT` | 0 | Not observed | Continue excluding if encountered. Recover only from an authoritative linked record proving exactly two distinct participants. |
| `SELF_MATCH` | 0 | Not observed | Continue excluding as malformed/unrecoverable unless source identity is authoritatively corrected. |

There are nine ineligible records total and each of the three observed reason counts is nine. Therefore all nine records necessarily carry the same combination: `NOT_COMPLETED`, `NOT_PLAYED`, and `MISSING_ACTIVITY_DATE`. They are expected chat check-in “did not play” outcomes, not nine completed matches missing dates. The conflict counter confirms there are zero records that are both completed and `not_played`.

There are also zero invalid dates and zero valid `playedDate`/`completedAt` pairs that resolve to different Melbourne months. No migration date fallback is warranted from this dataset.

## July 2026 partial-month results

The July audit scanned the same 36-document collection snapshot and included two July records:

| Metric | July count |
|---|---:|
| Eligible | 2 |
| Ineligible | 0 |
| Using `playedDate` | 2 |
| Using `completedAt` | 0 |
| Duplicate canonical IDs | 0 |
| Duplicate logical-match occurrences | 1 |

Both July events resolve to the same activity instant: 2026-07-07T14:00:00.000Z, which is Melbourne midnight at the start of 2026-07-08. That is consistent with date-only `playedDate` normalization.

July is necessarily partial because the report was generated on 2026-07-12. Two reported matches are plausible relative to May (2), June (1), and the small overall dataset. However, the one logical duplicate occurrence means July may represent either two legitimate same-pair matches on one day or one match entered twice. The deduplicated July count could therefore be one rather than two. The report alone cannot decide.

## Monthly eligible-match distribution

| Melbourne activity month | Eligible matches | Share of eligible history |
|---|---:|---:|
| 2025-12 | 1 | 3.7% |
| 2026-01 | 0 | 0.0% |
| 2026-02 | 2 | 7.4% |
| 2026-03 | 11 | 40.7% |
| 2026-04 | 8 | 29.6% |
| 2026-05 | 2 | 7.4% |
| 2026-06 | 1 | 3.7% |
| 2026-07 (through July 12) | 2 | 7.4% |

March and April contain 19 of 27 eligible matches (70.4%) and are the only clear volume spike. Activity falls sharply from eight in April to two in May and one in June. January is a gap, and no eligible history predates December 2025. With only 27 events, these changes may reflect product rollout, test/early-adopter activity, or normal small-sample variation; the aggregate reports cannot attribute a cause.

The 10 `playedDate` records versus 17 `completedAt` fallbacks suggest a schema/workflow transition, likely introduction of the chat check-in date field, but the current report does not break date source down by month. Add a monthly date-source distribution to a future audit before asserting when the schema changed.

## Eligible date range

- Earliest eligible instant: `2025-11-30T18:49:41.940Z`, which is 2025-12-01 05:49:41.940 AEDT in Melbourne and correctly belongs to month `2025-12`.
- Latest eligible instant: `2026-07-07T14:00:00.000Z`, which is 2026-07-08 00:00:00 AEST in Melbourne.

The range and monthly keys are consistent with the configured `Australia/Melbourne` timezone.

## Estimated player activity entries

Every eligible match has exactly two distinct participants, so 27 eligible events would generate 54 raw monthly player-match contributions before grouping by player.

If both duplicate logical occurrences are confirmed as accidental extra records, the corrected estimate is 25 matches and 50 player-match contributions. Therefore the defensible range is 50–54 contributions. This is not the number of unique monthly player documents: the aggregate reports intentionally contain no user IDs, so repeated players cannot be collapsed into unique player/month entries.

For July, the raw estimate is four player-match contributions; if its duplicate candidate is one accidental extra record, the corrected estimate is two.

## Duplicate analysis

### Canonical-ID duplicates

Count: zero.

No two audited source records select the same namespaced request/invite/history identifier. Consequently, no production evidence currently shows legitimate records being incorrectly merged by the canonical-ID precedence. Keep the current precedence for Phase 1; changing it now would add migration complexity without evidence.

Still add a guard for future collisions: if an existing normalized event with the same canonical ID has a different source path, participant pair, or activity fingerprint, log/quarantine the conflict instead of silently applying last-write-wins behavior.

### Logical-match candidates

Count: two duplicate occurrences in full history, one of them in July. The report does not expose group sizes, so this could mean two two-record groups or a larger group with two excess records.

The heuristic is canonical pair plus exact activity instant. Likely sources are:

- repeated chat check-in submissions using auto-ID `match_history` documents;
- parallel completion paths writing separate history documents;
- legitimate rematches between the same players on the same date, especially because date-only `playedDate` values normalize to identical Melbourne midnight instants.

Because canonical duplicate count is zero, every candidate has a distinct canonical ID and would create a separate `activity_match_events` document. Nothing would overwrite. If all two occurrences are accidental, future scoring would double-count two matches: up to four excess player-match contributions, 40 excess base completed-match points, and possible downstream new-opponent/streak distortion. July exposure is up to one excess match, two player contributions, and 20 base points.

Do not automatically deduplicate solely on pair plus exact activity time. It cannot distinguish two legitimate same-day matches. Safe automatic deduplication requires stronger agreement, for example:

1. same authoritative `matchRequestId` or `inviteId`;
2. same participant pair and source lineage;
3. compatible score/sets and completion source;
4. linked conversation/request references indicating one lifecycle;
5. deterministic source precedence when one flow is clearly a derivative copy.

Conflicting scores, different authoritative request/invite IDs, or date-only same-day matches without shared lineage require manual review. Enhance the read-only audit to report privacy-safe duplicate group summaries (group size, canonical namespace mix, source-flow markers, and whether score fingerprints agree) without emitting IDs.

## Recommended migration and normalization rules

1. Normalize all 27 currently eligible records, subject to duplicate classification.
2. Preserve all nine `not_played` records as ineligible audit events if normalization is run; never award activity and never synthesize dates for them.
3. Keep `playedDate` precedence and `completedAt` fallback unchanged. There is no cross-month conflict in production.
4. Keep exactly-two-participant and self-match exclusions unchanged; production currently has no exceptions requiring fallback logic.
5. Keep canonical-ID precedence unchanged for now because canonical collisions are zero.
6. Add a collision guard before backfill so one source cannot silently overwrite an incompatible normalized event.
7. Add a separate deduplication decision/alias layer for distinct canonical IDs that represent one logical match. Do not mutate source documents.
8. Resolve or quarantine the two logical duplicate occurrences before any scoring calculation.

## Required normalization tests

Add tests for:

- two source records with the same canonical ID and identical fingerprints;
- same canonical ID with conflicting participants/date, which must be quarantined or rejected rather than silently overwritten;
- distinct canonical IDs with the same pair and exact date;
- two legitimate same-pair matches on one date remaining distinct when authoritative lineage differs;
- repeated chat check-in submissions with matching lineage being deduplicated;
- `not_played` plus missing date remaining auditable and ineligible;
- completed record with missing date remaining ineligible;
- a future cross-month `playedDate`/`completedAt` disagreement retaining `playedDate` precedence;
- source identifier changes deleting the old derived event and writing the new deterministic event.

## Go/no-go recommendations

### Deploy the normalization trigger

**Conditional go.** Source quality is good enough for a non-scoring normalization trigger: 75% of records are eligible, all exclusions are expected no-match outcomes, and there are no malformed participants, invalid dates, cross-month conflicts, or current canonical collisions.

Before deployment, add canonical collision detection/structured logging and the collision/duplicate tests above. The trigger may preserve both logical candidates as separate auditable normalized events initially, provided no scoring consumer is enabled and duplicate candidates are explicitly flagged for review.

### Historical normalized-event backfill

**Not yet.** First classify the two logical duplicate occurrences and implement deterministic collision/deduplication behavior. Then run a dry-run backfill that predicts 27 raw normalized eligible events, nine ineligible audit events, and reports any conflicts. Only proceed to writes when dry-run counts reconcile.

### Canonical-ID logic

**Do not change the precedence based on this audit.** Zero canonical duplicates means there is no evidence of incorrect merging. Add conflict protection around the existing logic instead of changing IDs and forcing remapping.

### Deduplication rules

**Required before scoring or unrestricted backfill.** Use authoritative shared lineage for automatic merges. Treat pair-plus-date as a candidate signal only. Quarantine/manual-review groups lacking shared lineage or containing conflicting scores.

### Phase 2 monthly aggregation

**Design and unit-test work may begin, but production aggregation should not.** Resolve duplicate policy first. Phase 2 must consume only normalized events with an explicit deduplication status such as `included`, `duplicate_of`, or `review_required`, and must exclude unresolved candidates from published totals.

## Blocking issues

- Three confirmed duplicate groups still need deterministic scoring-survivor selection.
- Two possible duplicate groups require manual or stronger server-side reconciliation.
- Canonical collision protection is implemented but still needs Firestore emulator integration coverage for concurrent trigger transactions before deployment.
- Historical normalized-event backfill tooling and dry-run reconciliation are not yet implemented.

## Phase 1.1 reconciliation update

On 2026-07-12 the hardened, read-only reconciliation classifier scanned the same 36 production source records and considered all 27 structurally eligible events. It found five two-record review groups:

| Classification | Groups | Events held from scoring | Evidence | Months |
|---|---:|---:|---|---|
| `CONFIRMED_SAME_MATCH` | 3 | 6 pending survivor selection | Shared authoritative invite | March (2 groups), April (1 group) |
| `POSSIBLE_SAME_MATCH` | 2 | 4 pending review | Same pair/date/conversation and close completion time | April (1 group), July (1 group) |

This richer result supersedes the original audit's two pair-plus-exact-timestamp occurrences. The original heuristic found only the two possible groups; authoritative invite lookup identified three additional confirmed groups even where their normalized activity timestamps were not exact matches.

The reconciliation conservatively estimates 10 events held from scoring while reviews are pending. For each confirmed two-event group, a later server-side resolution should select one scoring survivor and mark one duplicate. The two possible groups require review because same-day rematches remain plausible. No source document was changed and no review document was written by the read-only command.

Phase 1.1 now uses hashed lookup keys for logical pair/day, request, and invite signals. This ensures shared authoritative identifiers are detected even across different activity dates while preserving the existing canonical-ID precedence. The normalized trigger creates bounded, server-only `activity_duplicate_reviews` records and blocks ambiguous/confirmed groups from future scoring.

## Non-blocking issues

- The nine ineligible records are expected no-match outcomes and require no recovery.
- July is partial and has a very small sample.
- Monthly date-source breakdown is absent, limiting schema-transition analysis.
- The legacy underscore-delimited pair ID retains its documented theoretical delimiter-collision limitation, but no audit evidence indicates an actual collision.

## Validation

This task changed documentation only. `git diff --check` passed. No tests or compilation were required. No Firestore query, write, deployment, trigger enablement, or backfill was performed.

## Phase 1.2 deterministic resolution and dry-run update (2026-07-13)

Phase 1.2 adds resolution version 1. A confirmed group is automatically resolved only when every member has the same participant pair, the group shares one authoritative request or invite identifier, all explicit `playedDate` values agree, and there is no corroborated result conflict. A raw score fingerprint difference alone is not treated as a contradiction because current lifecycle paths represent the same score differently (string versus structured sets); differing score fingerprints plus differing winner identifiers remain a pending material conflict.

Survivor precedence is deterministic: valid `playedDate`, richer request/invite/conversation lifecycle data, score/sets presence, earliest activity timestamp, earliest source completion timestamp, then lexicographically smallest source path. These criteria preserve the best activity and audit evidence and exclude mutable profile fields and Firestore query order.

The production read-only dry run scanned 36 sources: 27 structurally eligible and nine ineligible. It generated 36 auditable event projections with no canonical conflicts. All three authoritative two-member groups auto-resolved (two in March and one in April), producing three scoring survivors and three retained excluded duplicates. The two possible groups remain pending, holding four events from scoring. The resulting expected scoring-eligible count is 20 events, or 40 player-match contributions. Monthly scoring-eligible counts are: December 2025 one; February 2026 two; March nine; April five; May two; June one; July zero pending review.

Privacy-safe possible-group evidence:

- April: two events; identical activity timestamps; completion separation one minute; matching played dates, conversation, score, winner and location fingerprints; same or missing completion-path marker; neither has request nor invite authority. Confidence remains medium and the group stays pending.
- July: two events; identical activity timestamps; completion separation six minutes; matching played dates, conversation and location fingerprints; different score fingerprints; winner data missing; same or missing completion-path marker; neither has request nor invite authority. Confidence remains medium and the group stays pending.

Two consecutive full-history dry runs produced checksum `622f3f48497776a2ebe92104e8381febb62e218d545e25df396ad48c3b9639da`. The July-only checksum is `2e1144d4fcdb4e521cb5c34047cc32a4bc4ac84d385fb9eede8066bc2637ce4c`; July contains two structurally eligible events, both pending and therefore zero scoring-eligible contributions.

Normalization-trigger deployment is not yet recommended until the extracted transaction path has complete emulator concurrency coverage. A historical write backfill is also not recommended in this phase: the implemented command deliberately rejects `--write`, and the two possible groups still require a product/manual decision or stronger authoritative evidence. Phase 2 calculation code may be designed against `eligibleForScoring`, but production aggregation remains blocked on those decisions and transaction-emulator validation. No production write or deployment occurred.

## Phase 1.3 transaction validation update (2026-07-13)

The normalization trigger is now a thin adapter over the exported `normalizeAndPersistMatchHistoryWrite` transaction handler. The same production handler is exercised against the Firestore emulator for concurrent same-source writes, absorbing canonical collision quarantine, confirmed-duplicate insertion order and retries, automatic survivor deletion/reselection, survivor precedence changes, manual duplicate/distinct precedence, stale manual fingerprints, manual-survivor deletion, possible duplicates, distinct rematches, month movement, ineligible transitions, source deletion, and bounded diagnostics. Security-rule tests continue to deny authenticated and unauthenticated client access to every generated Activity Leaderboard collection.

Manual decisions take precedence only after structural eligibility and collision checks. A current fingerprint-bound manual decision is applied before automatic resolution; stale or rejected decisions persist inspectable status and fail closed. Deleting a manually selected survivor never silently substitutes another survivor.

The final emulator run passed ten persistence scenarios and two security scenarios. Fifty-four unit tests, TypeScript compilation, targeted lint, and whitespace validation passed. Two final full-history dry runs retained checksum `622f3f48497776a2ebe92104e8381febb62e218d545e25df396ad48c3b9639da`; two July runs retained `2e1144d4fcdb4e521cb5c34047cc32a4bc4ac84d385fb9eede8066bc2637ce4c`.

The non-scoring normalization trigger is now recommended for a controlled deployment with monitoring. A controlled normalized-event production backfill can follow only after deployment observation and an explicitly reviewed write-mode implementation; the current backfill remains dry-run-only. The April and July possible groups remain pending until an authorized manual decision or stronger evidence is recorded. No production write, resolution, backfill, or deployment occurred during Phase 1.3.

## Guarded production-backfill readiness update (2026-07-19)

The normalization trigger has since been deployed and a natural production completion successfully exercised it: HTTP 200, eligible July event, no ineligibility reasons, dirty-month creation, and no runtime error. The trigger remains active.

The backfill now plans against stored normalized events, duplicate reviews, manual resolutions, and dirty months. Identical events are unchanged; deterministic older state is updated; newer unsupported normalization state and canonical conflicts fail closed. Possible duplicates remain non-scoring, manual resolution precedence is retained, and potential stale/orphaned derived documents are reported without deletion. A production write re-reads the source immediately before confirmation and requires its checksum to match the approved preview.

The historical reference snapshot remains 36 source records, 27 structurally eligible, nine ineligible, three auto-resolved confirmed groups, three excluded duplicate copies, two possible groups/four pending events, 20 scoring events, 40 player contributions, and zero canonical conflicts. Its reference checksums are `622f3f48497776a2ebe92104e8381febb62e218d545e25df396ad48c3b9639da` for full history and `2e1144d4fcdb4e521cb5c34047cc32a4bc4ac84d385fb9eede8066bc2637ce4c` for July. Because the natural completion may have changed `match_history`, fresh repeated previews are authoritative and any deterministic change must be recorded rather than coerced to these older values.

No production write, backfill write, duplicate-resolution write, cleanup, rollback, rule deployment, or function deployment is authorized by this update.

The completed 2026-07-19 validation confirms the natural source event changed the snapshot rather than introducing nondeterminism. Two full-history previews matched at checksum `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`: 37 sources, 28 eligible, nine ineligible, 21 scoring survivors, three excluded confirmed copies, four possible-duplicate events pending, and zero canonical conflicts. Two July previews matched at checksum `77f59f1f5d902d88b4df79509b08e8acbfa3a7380c9f924a6510c7d5cca97e19`: three eligible source events, one scoring survivor, and two pending events. Relative to the earlier snapshot, source, eligible, scoring, and July counts each rose by one while duplicate and conflict counts stayed stable.

The production-derived collection intentionally remains only partially populated before approval. Read-only reconciliation reported 36 missing historical normalized events, one existing event with a deterministic version/eligibility mismatch, no unexpected events, five missing full-history duplicate reviews, and six missing historical dirty-month requests. July reconciliation reported two missing events, the same existing mismatch, one missing review, and no dirty-month mismatch. These are the expected pre-backfill differences and demonstrate that reconciliation detects them without modifying Firestore.

## Historical normalization completed (2026-07-19)

Authorized run `activity-20260719025418-a2afd18007` completed the normalized-event history at checksum `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`. It created 36 events and updated the one trigger-created v1 event. Final read-only reconciliation matched all 37 expected events exactly with no missing, unexpected, field, version, eligibility, duplicate-resolution or dirty-month discrepancies.

The source-quality conclusion is unchanged: 28 records are structurally eligible and nine are ineligible no-match outcomes. Three confirmed duplicate copies are excluded, four possible-duplicate events remain pending and non-scoring, and 21 events are scoring eligible. There are zero canonical conflicts. No source record or manual duplicate resolution was modified by the backfill.
