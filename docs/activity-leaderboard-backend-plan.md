# TennisMate Monthly Activity Leaderboard — Backend Foundation Plan

Status: Phase 1 production facts are verified. The June 2026 Phase 2 pilot completed and reconciled on 2026-07-19. The dedicated Phase 2 run-audit lifecycle and server-only rules are deployed, and the missing June audit was reconstructed as `activity_phase2_runs/phase2-pilot-2026-06-1784436876993`. All other month requests remain pending at zero attempts and processing stays disabled with `ACTIVITY_PHASE2_ENABLED=false`.

## Executive summary

The proposed canonical monthly aggregate plus separately materialized rankings fits this codebase, but the leaderboard should not consume the current client-written collections directly without a normalization layer.

The strongest current evidence of a played match is a `match_history` document with `completed == true` or `status == "completed"`. It has the richest fields, including participants and `completedAt`. `completed_matches` is not a complete source: one completion path only creates it when a score is entered, its schema is sparse, and multiple creation paths use different document IDs. Conversely, `match_history` also contains `not_played` records and can be created or updated by a participating client. The backend should therefore normalize eligible history records into deterministic, server-only `activity_match_events/{canonicalMatchId}` documents and calculate monthly aggregates from those normalized events.

There is currently no score-confirmation workflow in the repository. A participant can create or overwrite `match_scores/{matchId}`; no `confirmedBy`, per-player confirmation, or equivalent field exists. The +3 both-confirmed score bonus cannot be awarded safely until an explicit server-validated confirmation model is added.

The existing deterministic pair ID is the two trimmed UIDs sorted lexicographically and joined with `_`. It is useful for lookup, but `player_relationships` only keeps latest references and explicitly does not maintain completed-match counters. First-opponent status must be derived from all eligible normalized completed events for the pair, ordered by the actual played/completion date and deterministically tie-broken.

### Phase 2 implementation update

Phase 2 implements the national monthly leaderboard described in [activity-leaderboard-phase2-implementation.md](activity-leaderboard-phase2-implementation.md). It uses only `eligibleForScoring === true` normalized events, stores raw metrics separately from v1 points, stages deterministic generations, and atomically changes the published-generation pointer only after all aggregate and ranking writes succeed. Internal aggregates and requests remain client-inaccessible; signed-in clients may read only the current published ranking generation.

Product approval was recorded on 2026-07-19. The approved contract is: ten points per capped activity plus five per distinct opponent; four point-bearing activities per opponent/month; uncapped raw eligible activity; competition ranks; signed-in visibility; refresh public name/avatar on rebuild; an exact eight-field public ranking row; and 30-day server-only retention for retired generations. The approved production pilot month is `2026-06`.

Each future pilot or scheduled recalculation attempt must create `activity_phase2_runs/{runId}` as `RUNNING` in the request-claim transaction. Publication, request completion, and audit `COMPLETED` share one final transaction; failures transition the owned request and audit to failed together. The collection is server-only and excludes all player/event identifiers and profile data. The already-valid June pilot is not recalculated: its missing audit can be created only by the separately guarded, evidence-only reconstruction utility documented in [activity-leaderboard-phase2-implementation.md](activity-leaderboard-phase2-implementation.md).

The v1 formula is `10 * cappedActivityCount + 5 * distinctOpponentCount`, with at most four point-bearing activities against one opponent in a calendar month. Raw `eligibleActivityCount` remains uncapped. Displayed competition rank is tied on points, distinct opponents, and capped activity count; deterministic row order then uses latest activity descending and player ID ascending. Score confirmation, streaks, first-opponent bonuses, and location scopes remain deferred to later versioned calculations.

Both scheduled exports are fail-safe disabled unless the declared `ACTIVITY_PHASE2_ENABLED` Functions parameter is true. This covers recalculation and 30-day retired-generation cleanup. The production deployment must explicitly set it to false because the verified Phase 1 run left seven month requests pending.

## 1. Existing data model findings

### 1.1 Completed-match lifecycle and source of truth

There are at least three completion paths.

1. The standard score-entry page writes `match_scores/{matchRequestId}`, updates `match_requests/{matchRequestId}` to completed, and upserts `match_history/{matchRequestId}` with `completedAt`, players, score and sets. Relevant code: `app/matches/[id]/complete/details/page.tsx:235-269`, `:283-367`, and `:369-399`.
2. The summary page waits until the second participant adds their UID to `match_requests.completedBy`, creates a new auto-ID `match_history` document, deletes the request, then writes deterministic `completed_matches/{matchRequestId}`. Relevant code: `app/matches/[id]/summary/page.tsx:140-180`, `:188-237`.
3. Chat check-in immediately creates an auto-ID `match_history` record. If an optional score was entered, it additionally creates auto-ID `match_scores` and `completed_matches` records. Relevant code: `components/matches/MatchCheckInOverlay.tsx:254-355`, `:383-460`. A “not played” response also creates `match_history`, but with `completed: false`, `completedAt: null`, `outcome: "not_played"`, and `status: "not_played"` (`:471-539`).

Current document shapes are not uniform:

- `match_history` commonly stores `players`, `fromUserId`, `toUserId`, names/photos, `completed`, `status`, `winnerId`, `score`, `sets`, `completedAt`, `updatedAt`, `matchRequestId`/`inviteId`, and relationship fields. Chat check-in additionally stores `playedDate`, `court`, `location`, `conversationId`, `outcome`, and `completedFrom` (`components/matches/MatchCheckInOverlay.tsx:308-354`).
- `completed_matches` stores at minimum `fromUserId`, `toUserId`, `matchId`, `winnerId`, and `timestamp`; newer writes add `pairId`, `relationshipRefPath`, and (through the helper's payload conventions) may include `players` only when supplied by the caller. See `app/matches/[id]/summary/page.tsx:225-237` and `components/matches/MatchCheckInOverlay.tsx:420-432`.
- Participant extraction elsewhere already has to union `players`, `fromUserId`, and `toUserId`, demonstrating schema variability (`functions/src/playerPublicStats.ts:21-27`, `:57-65`).

Recommended present-day completion evidence:

- Primary input: eligible `match_history`, not `completed_matches`.
- Eligibility: exactly two distinct participant UIDs; `completed == true` or `status == "completed"`; explicitly reject `outcome == "not_played"`; require a valid activity date; reject malformed/self matches.
- Activity date: prefer a valid user-entered `playedDate` when present because that represents when tennis occurred; otherwise use `completedAt`; use `movedAt`, `updatedAt`, or a linked `completed_matches.timestamp` only as migration fallbacks and record which fallback was used. Calendar month/week boundaries must use one explicit product timezone (recommended `Australia/Sydney` for MVP, pending product confirmation).

Duplicate risk is real:

- The same logical match can be represented in `match_requests`, `match_history`, `match_scores`, and `completed_matches`.
- Standard completion uses the request ID for history/score, the summary path uses an auto-ID for history and request ID for completed match, and chat check-in uses unrelated auto-IDs.
- Client sequences are not transactional. A retry or partial failure can leave duplicates or incomplete cross-collection records. Chat check-in's `addDoc` operations are especially retry-sensitive.
- Existing stats deduplicate using history document IDs and `completed_matches.matchId || doc.id`, which cannot reliably collapse auto-ID history/check-in records (`functions/src/playerPublicStats.ts:115-139`).

Editing/deletion/cancellation:

- Participating clients may update `match_history`, `match_scores`, and `completed_matches` while identity fields remain unchanged; clients cannot delete them (`firestore.rules:430-465`). Thus scores and completion-related fields can be edited.
- `match_requests` can be participant-updated but not client-deleted under current rules (`firestore.rules:364-393`); the Admin SDK/account cleanup and existing client code have different effective capabilities.
- UI copy explicitly says removing a confirmed request preserves completed history and scores (`components/matches/DesktopMatches.tsx:2245-2246`; equivalent mobile code at `app/matches/MatchesPageClient.tsx:2549-2550`).
- Account deletion removes match-related records involving the user and then deletes `users`, `players`, `players_private`, and Auth (`functions/src/index.ts:194-325`, with cleanup queries around `:2037-2205`). Historical leaderboard retention therefore needs a stated deletion/anonymization policy.

### 1.2 Score storage and confirmation

Scores are stored in `match_scores`. The standard document is keyed by match request ID and contains `players`, optional `inviteId`, `livePoints`, `tiebreakMode`, `matchComments`, `sets`, `updatedAt`, and relationship fields (`app/matches/[id]/complete/details/page.tsx:322-338`). The score string and sets are also copied into `match_requests` and `match_history` (`:360-398`). Chat check-in instead creates an auto-ID score document containing `players`, `sets`, and `updatedAt` (`components/matches/MatchCheckInOverlay.tsx:383-394`).

There is no mutual confirmation mechanism:

- No confirmation field or condition appears in the score write path.
- Either match participant can create or update a score document; only identity fields are protected (`firestore.rules:430-438`, helper at `:106-116`).
- The standard flow writes the score before/upstream of the history completion record. Chat check-in writes history first, then optional score and completed match. Therefore temporal ordering is path-dependent.

The exact condition proving confirmation by both players does not exist. The future bonus must require a server-controlled condition such as `confirmedBy` containing exactly both canonical participant UIDs (or two per-user confirmation subdocuments), with confirmations bound to an immutable `scoreVersion`/hash so editing the score invalidates prior confirmations.

### 1.3 First-time opponent detection

Pair normalization already exists: trim both UIDs, sort lexicographically, join with `_` (`lib/playerRelationships.ts:60-68`). Newer lifecycle records receive `pairId` and `relationshipRefPath` (`:88-110`). Backfill scripts derive pairs from common fields or related match records (`scripts/backfillCompletedMatchRelationships.js:8-17`; `scripts/relationshipBackfillCommon.js:106-138`).

Collection reliability:

- `player_relationships`: reliable as a deterministic pair identity/link when present, but not as proof that a completed match occurred or which one was first. It keeps latest interaction refs and its own comment says counters/stats are deferred (`lib/playerRelationships.ts:122-140`, `:245-289`). Client update failures are caught and do not roll back match creation.
- `completed_matches`: incomplete because scoreless chat check-ins do not create it and its IDs vary.
- `match_history`: best available historical evidence, provided eligibility/deduplication rules are applied and legacy records missing pair fields are repaired.

Safest first-opponent calculation: build normalized eligible event records; group by `pairId`; sort by `activityDate`, then stable canonical event ID; mark only the earliest event `isFirstCompletedMatchForPair: true`. Recalculating a historical month must scan/look up eligible events before that month as well, or use a server-only pair-first ledger rebuilt from the full event set. Do not infer “first” from relationship creation time or latest refs.

### 1.4 Player leaderboard profile data

Public source is `players/{uid}`. Signup writes `name`, `postcode`, `photoURL`, `photoThumbURL`, `profileComplete`, `isMatchable`, and other public profile fields (`app/signup/page.tsx:335-359`). `users/{uid}` also receives name/photos but should not be the leaderboard profile source (`:375-385`). Private location is in `players_private/{uid}`: `postcode`, `lat`, `lng`, `geohash`, email, and birth year (`:361-369`). Rules explicitly classify `lat`, `lng`, and geohash as sensitive and restrict private docs to the owner (`firestore.rules:14-20`, `:228-243`). Server-side nearby search joins private coordinates to public profiles (`functions/src/nearbyPlayers.ts:109-152`, `:164-232`).

Field findings:

- Display name: `players.name` (not `displayName`).
- Image: prefer `players.photoThumbURL`, fallback `players.photoURL`.
- Postcode: public `players.postcode`; duplicated in private profile.
- Suburb, city/market, state: no canonical player fields were found. The postcode importer currently writes coordinates but comments out state and does not store suburb/city (`scripts/import-postcodes.js:45-68`, `:83-96`).
- Coordinates: canonical current location is private `players_private.lat/lng`; legacy/public fallbacks exist in function code, but new rules prohibit clients adding sensitive coordinates to `players`.
- Profile completion: `players.profileComplete === true`; nearby results also exclude `isMatchable === false` (`functions/src/nearbyPlayers.ts:181-187`).
- Account status/suspension: no canonical suspension/status flag was found. Account deletion physically removes profile/Auth and related data (`functions/src/index.ts:284-304`).

Snapshot recommendation:

- Copy into monthly/ranking docs: display name, thumbnail URL, suburb/postcode/state/city scope keys, and a coarse location assignment/version as-of calculation time. This preserves historical displays and avoids N+1 reads.
- Do not copy exact latitude/longitude into client-readable leaderboard documents. It would expose data currently protected as private. Nearby-radius results should be server-computed and return distance/coarse locality only.
- Keep `profileEligible`, `accountState`, and `locationSource/version` server-evaluated. Decide whether renamed photos should update historical months; recommendation is immutable monthly snapshots except for privacy/deletion redaction.

## 2. Existing Cloud Functions patterns

- Admin initialization: `if (admin.apps.length === 0) admin.initializeApp()`, then shared `db` (`functions/src/index.ts:29-32`). Some imported modules call `admin.firestore()` at module load, relying on index initialization order (for example `functions/src/playerPublicStats.ts:1-3`).
- Default region: global `australia-southeast2` with `maxInstances: 10` (`functions/src/index.ts:26-27`), matching Firestore location (`firebase.json:10-14`). Some scheduled/imported functions explicitly use `australia-southeast1`, so deployment region is inconsistent (`functions/src/postMatchReminders.ts:113-119`; `functions/src/referralOnMatchAccepted.ts:8-9`). New Firestore-heavy functions should use `australia-southeast2` unless deployment constraints dictate otherwise.
- Triggers: v2 `onDocumentCreated`, `onDocumentUpdated`, and `onDocumentWritten`; existing public-stat triggers recompute affected users from both before and after snapshots (`functions/src/index.ts:361-407`). That before/after pattern is appropriate for edited/deleted leaderboard inputs.
- Schedules: v2 `onSchedule`, explicit timezone/region/memory, run ID, start/end diagnostics (`functions/src/postMatchReminders.ts:113-130`).
- Logging: structured objects with a stable prefix, source IDs, UID, run ID, counts and errors. Older emoji/free-text logs also exist. New code should consistently use structured logs and never log private coordinates.
- Transactions/batches: `messageNotifications` uses `db.runTransaction`; cleanup and scripts use batches. Relationship backfills default to dry-run, count reasons, and commit below the 500-write ceiling (`scripts/relationshipBackfillCommon.js:141-168`, `:211-245`).
- Shared utilities: backend logic is currently split into focused modules imported by a large `functions/src/index.ts`; leaderboard code should follow the focused-module pattern.
- Tests/emulators: `firebase-functions-test` is installed, and `functions/package.json` has build/serve/shell scripts, but no repository test script or Firestore/Auth emulator configuration was found (`functions/package.json:3-12`, `:25-33`; `firebase.json:2-5`). Add unit tests and Firestore emulator configuration before enabling writes.
- Deployment: TypeScript build is a Firebase predeploy hook (`firebase.json:16-23`); functions scripts include `deploy` and `logs` (`functions/package.json:6-12`).

## 3. Risks and inconsistencies

1. Client participants can manufacture or modify completion and score records. Existing collections are evidence, not trusted award events.
2. Completion flows are non-transactional and schema/ID conventions differ, creating partial writes and duplicate logical matches.
3. `completed_matches` is not complete; `match_history` mixes completed and not-played outcomes.
4. No mutual score confirmation exists, so the +3 rule is presently unimplementable.
5. `completedAt` often means entry/confirmation time, while optional string `playedDate` may represent actual activity time. Timezone/date parsing needs a formal contract.
6. A lexicographic pair ID joined with `_` can theoretically collide if UIDs contain the delimiter. Firebase Auth UIDs commonly permit arbitrary strings. Preserve compatibility initially, but a length-prefixed/hash pair key is safer for new server-only ledgers.
7. Existing `processCompletedMatch` performs read-then-increment player stats on create, which is retry/concurrency unsafe and assumes a non-null winner/loser (`functions/src/index.ts:2833-2865`). The leaderboard must not copy this pattern.
8. Existing public stats recompute an entire user's history on every write and deduplicate imperfectly across inconsistent IDs (`functions/src/playerPublicStats.ts:68-151`). This is acceptable precedent for correctness-first recompute, not a scalable leaderboard algorithm.
9. Exact coordinates are private today; proposed public snapshots containing latitude/longitude would weaken privacy.
10. State/city/suburb are not canonical, so local scopes cannot be correct until a postcode-to-scope mapping exists.
11. Account deletion erases source matches, conflicting with historical retention unless anonymization and recalculation semantics are defined.
12. Existing region conventions differ between `australia-southeast1` and `australia-southeast2`.

## 4. Recommended scoring sources of truth

| Scoring action | Trusted eventual condition | Current repository support |
|---|---|---|
| Completed match, +10/player | Server-normalized eligible event derived from completed history, exactly two users, valid activity date, not not-played/cancelled, deterministic canonical ID | Feasible after normalization; use `match_history` as primary evidence |
| New opponent, +5/player | Event is earliest eligible normalized event for canonical pair | Feasible after full-history pair ordering; do not use relationship creation time |
| Score confirmed by both, +3/player | Server-controlled confirmation state contains both participants for the same immutable score version/hash | Not supported; must add confirmation workflow first |
| Consecutive active playing week, +5 | User has eligible completed activity in adjacent product week keys under a documented boundary/timezone; award per defined transition | Feasible, but product semantics across month/year boundaries are unresolved |

The scoring engine must consume normalized server-only events and recompute totals from facts; it must never increment points in response to an unverified client write.

## 5. Recommended Firestore schema

### 5.1 Normalized event layer (server-only)

`activity_match_events/{canonicalMatchId}`

```text
canonicalMatchId, sourceRefs[], sourceFingerprint
participantIds[2], pairId
activityAt, activityDateSource, monthKey, weekKey, timeZone
eligible, ineligibilityReasons[]
scorePresent, scoreVersion, scoreConfirmedBy[], scoreConfirmedByBoth
isFirstCompletedMatchForPair
location/scope metadata needed for audit (no public exact coordinates)
createdAt, updatedAt, normalizedAt, normalizationVersion
```

Canonical ID preference: stable original `matchRequestId`/invite match ID when provably shared; otherwise a deterministic hash of sorted participants plus stable source identity and activity details. Ambiguous potential duplicates should be logged/quarantined, not silently merged.

### 5.2 Canonical monthly player aggregate

Keep the proposed path: `activity_months/{monthKey}/players/{userId}`. Add explicit eligibility/rules metadata and avoid unbounded arrays:

```text
userId, monthKey
activityPoints
completedMatchCount, newOpponentCount, confirmedScoreCount
activeWeekCount, streakBonusCount
pointBreakdown { completedMatches, newOpponents, confirmedScores, streaks }
lastActivityAt
scopeKeys[]                         // e.g. australia, state:VIC, city:melbourne
profileSnapshot { displayName, profileImageUrl, suburb, postcode, state, city }
profileEligible, accountState
calculationVersion, sourceWatermark, calculatedAt
```

Do not store `opponentIds` or `activeWeekKeys` indefinitely in the public aggregate. Use server-only calculation working documents/subcollections or normalized-event queries; arrays can grow, expose social graph data, and approach document limits.

Store a metadata document at `activity_months/{monthKey}` with status (`building|published|failed`), calculation version, timezone, started/completed timestamps, counts, and run ID. Build under a generation/version and atomically flip the published generation pointer so readers never see half-rebuilt rankings.

### 5.3 Ranked views

Recommended path:

`activity_leaderboards/{monthKey_scopeKey}/rankings/{userId}` with parent fields describing `monthKey`, `scopeType`, `scopeValue`, `generation`, and `calculatedAt`.

The originally proposed `activity_leaderboards/{monthKey}/scopes/{scopeKey}/rankings/{userId}` is Firestore-valid, but adds an extra hierarchy without improving queryability. A deterministic composite parent ID simplifies rules and rebuilds. Encode/validate scope keys safely (for example `2026-07__state__VIC`).

Ranking documents should contain `rank`, `tieRank` if applicable, deterministic `sortKey`, points/counts, scope, generation, and the compact profile snapshot. Explicit ranks are appropriate because the product requires rank numbers, ties/pagination are otherwise expensive, and clients must not calculate rankings. Canonical aggregates may also be queried `orderBy(activityPoints desc)` for internal/debug use, but should not replace published rankings.

## 6. Calculation strategy

Use a correctness-first hybrid:

1. An `onDocumentWritten("match_history/{id}")` normalizer validates/reconciles that logical match and writes/deletes (or marks ineligible) its deterministic server-only activity event. It must consider both before and after, so participant/date/month changes dirty both old and new months.
2. Score writes/confirmations dirty the associated event/month but cannot award confirmation points until the explicit confirmation model exists.
3. A lightweight dirty-month queue (`activity_recalculation_requests/{monthKey}`) is upserted idempotently; triggers do not increment totals.
4. A scheduled worker processes dirty months and also performs a nightly reconciliation for the current and previous month.
5. An admin callable/CLI backfill can rebuild one month or a range with a requested `calculationVersion`, dry-run summaries, and a force flag.
6. Monthly calculation reads eligible normalized events, derives player facts, first-pair ordering, active week transitions, totals and ranks, writes in chunks below 500 operations (recommend 400), then publishes the generation.

This is safe under retries because outputs are deterministic `set`/delete operations for a generation, never blind increments. Rebuilding a month only replaces that month's generation. First-opponent and streak calculations must include boundary context: all prior pair events for “first”, and at least the prior week (possibly prior month/year) for streaks.

Tie policy must be product-defined. Recommended deterministic order: points descending, completed match count descending, last activity ascending or descending only if product agrees, then UID ascending. Use competition rank (`1, 2, 2, 4`) or dense rank explicitly; do not let UID alter displayed tie rank.

## 7. Trigger and schedule strategy

- `normalizeActivityOnMatchHistoryWrite`: v2 Firestore written trigger in `australia-southeast2`; validate before/after and enqueue affected months.
- `markActivityDirtyOnScoreWrite`: initially normalization-only; later responds to server-validated score confirmation transitions.
- `recalculateDirtyActivityMonths`: v2 schedule, `Australia/Sydney`, `australia-southeast2`, bounded concurrency and lease/transaction per month.
- `reconcileRecentActivityMonths`: nightly rebuild/checksum for current and previous month to repair missed events.
- `recalculateActivityMonth` admin-only callable or CLI: explicit month/version/dry-run; App Check and admin custom claim if callable.
- Optional month-close job: publish final prior-month generation, while still allowing versioned historical recalculation.

Structured logs should include `runId`, `monthKey`, `generation`, `calculationVersion`, trigger source/path, scanned/eligible/rejected/deduplicated counts, writes, duration, and categorized failures. Do not log exact private coordinates or full profile payloads.

## 8. Recommended indexes

Add only after final query implementation is fixed:

- `activity_match_events`: `eligible ASC, monthKey ASC, activityAt ASC`.
- `activity_match_events`: `pairId ASC, eligible ASC, activityAt ASC` (first-opponent calculation).
- `activity_match_events`: `participantIds ARRAY_CONTAINS, eligible ASC, activityAt ASC` if per-player rebuilds are supported.
- Rankings collection group (if queried across parents): `monthKey ASC, scopeKey ASC, generation ASC, rank ASC`. Normal reads within a scope parent by `rank` generally use the automatic single-field index.
- Canonical monthly players collection group, if used: `monthKey ASC, activityPoints DESC, completedMatchCount DESC`.
- Dirty requests: `status ASC, requestedAt ASC`.

The existing indexes file contains no relevant match-history, completed-match, relationship, or leaderboard composite indexes (`firestore.indexes.json:1-102`). Avoid indexing large audit arrays/maps where unused via field overrides if storage becomes significant.

## 9. Recommended security rules

All normalized events, recalculation requests, month metadata, canonical aggregates, and rankings must reject client writes (`allow create, update, delete: if false`). Admin SDK functions bypass rules.

Recommended reads:

- Published ranking parents/documents: `allow read: if signedIn()` and resource generation equals the published generation. If leaderboards will be public, make that a deliberate separate decision.
- Canonical player monthly aggregates: signed-in read only if frontend needs them; otherwise deny and expose only rankings/callable results.
- Normalized events, dirty queue, calculation metadata/audit details: `allow read, write: if false` for clients.
- Exact coordinates remain only in `players_private` and server processing; never place them in readable leaderboard docs.

Add explicit matches before the ruleset's final catch-all (if any), following the existing server-generated `player_public_stats` pattern (`firestore.rules:246-249`). Rules tests must prove unauthenticated reads fail, signed-in published reads succeed, and every client mutation fails.

## 10. Proposed implementation phases

### Phase 0 — decisions and data audit

- Decide timezone, played-date precedence, week definition, streak semantics at month boundaries, tie/rank policy, city/market mapping, deletion/anonymization policy, and eligibility of non-matchable/suspended users.
- Run dry-run audits for missing/invalid participant pairs, dates, duplicate match IDs, and conflicts across lifecycle collections.

### Phase 1 — trusted normalized facts

- Add shared types/date/pair/dedup utilities and `activity_match_events` normalizer.
- Add rule protection, structured logs, unit tests, emulator rules tests, and dry-run backfill.
- Do not expose a leaderboard or award score-confirmation points yet.

### Phase 2 — monthly aggregates and backfill

- Implement versioned single-month calculation, dirty-month requests, generation publishing, chunked writes, and historical backfill.
- Validate results against sampled raw histories and reconciliation checksums.

### Phase 3 — location scopes and rankings

- Introduce authoritative postcode-to-state/city/market mapping and privacy-approved coarse snapshots.
- Materialize national/state/city ranks with explicit tie semantics and publish generations.

### Phase 4 — event-driven maintenance

- Enable match-history trigger, scheduled dirty worker, recent-month reconciliation, monitoring and alerting.
- Keep the manual rebuild path as recovery tooling.

### Phase 5 — score confirmation bonus

- Add immutable score versions/hashes and per-participant server-validated confirmations.
- Invalidate confirmations on edits; only then enable +3 under a new calculation version and rebuild affected history.

## 11. Exact files proposed for a future implementation

No files below are changed in this planning task.

Create:

- `functions/src/activityLeaderboard/types.ts`
- `functions/src/activityLeaderboard/config.ts`
- `functions/src/activityLeaderboard/normalization.ts`
- `functions/src/activityLeaderboard/calculation.ts`
- `functions/src/activityLeaderboard/ranking.ts`
- `functions/src/activityLeaderboard/triggers.ts`
- `functions/src/activityLeaderboard/schedules.ts`
- `functions/src/activityLeaderboard/admin.ts`
- `functions/src/activityLeaderboard/__tests__/normalization.test.ts`
- `functions/src/activityLeaderboard/__tests__/calculation.test.ts`
- `functions/src/activityLeaderboard/__tests__/ranking.test.ts`
- `functions/test/firestore/activityLeaderboard.rules.test.ts`
- `scripts/auditActivityLeaderboardSources.ts`
- `scripts/backfillActivityLeaderboard.ts`

Modify:

- `functions/src/index.ts` — export new triggers, schedules, and guarded admin entry point.
- `firestore.rules` — read policy and deny all client writes for generated/server-only collections.
- `firestore.indexes.json` — indexes matching implemented event/ranking/queue queries.
- `firebase.json` — Firestore/Auth emulator configuration for rules/integration tests.
- `functions/package.json` — test and leaderboard audit/backfill scripts (and test runner dependency if required).
- Score-entry/confirmation UI and rules files only in Phase 5, after the confirmation design is approved; likely `app/matches/[id]/complete/details/page.tsx` and `firestore.rules`, preferably moving score mutations behind a callable rather than expanding client authority.

## 12. Questions not answerable from the repository

1. Is an activity assigned to the month/week of `playedDate` or the time both players complete/confirm it? What timezone governs boundaries?
2. Does a “consecutive active playing week” award +5 for every adjacent active-week transition, and may a transition cross month/year boundaries? Which month owns that bonus?
3. What constitutes a week (Monday-Sunday is recommended for Australia)?
4. How should rank ties display, and what secondary ordering is desired?
5. What authoritative mapping defines suburb, city/market and state from postcode, especially ambiguous postcodes?
6. Should users with `isMatchable: false` remain on historical/current leaderboards? What is the suspension flag/source?
7. After account deletion, should historical rankings remove the row, retain an anonymized row, or retain the snapshot? Current cleanup removes source records.
8. Are chat check-ins without mutual completion intended to count as “confirmed completed matches,” or must both players acknowledge them?
9. Can doubles/team matches enter these collections in future? Current pair utilities require exactly two distinct UIDs.
10. Should historical display snapshots remain frozen, receive profile-name/photo updates, or only be changed for privacy requests?
11. What is the expected current/near-future user and completed-match volume? This determines whether full pair-history scans need partitioning or a derived pair-first ledger.
12. Are there production-only fields/collections, deployed functions, or external admin processes not represented in this repository? A read-only production schema audit is needed before backfill.

## Final architecture recommendation

Adopt the canonical monthly aggregate and separate published ranking documents, with explicit stored ranks. Use a hybrid of event-driven normalization/dirty marking plus scheduled deterministic month rebuilds and nightly reconciliation. Before any points are enabled, establish server-only normalized activity events, formal date/timezone/deduplication rules, coarse location scope data, and generated-collection security rules. Defer the confirmed-score bonus until mutual confirmation is represented explicitly and cryptographically/logically bound to a score version.
