# Activity Leaderboard Phase 2 implementation record

Date: 2026-07-19  
Status: all seven approved production months completed and verified on 2026-07-19. The run-audit lifecycle and server-only rules are deployed, June's missing audit was reconstructed from verified metadata, and the other six months have native LIVE audits. Scheduled processing remains inert with `ACTIVITY_PHASE2_ENABLED=false`.

## Scope and invariants

Phase 2 consumes the verified `activity_match_events` collection. A canonical event contributes only when `eligibleForScoring === true`. Each of its exactly two distinct participants is credited once. Confirmed duplicate exclusions and pending possible duplicates therefore do not score under their current normalized eligibility. Malformed scoring events and newer normalization/calculation versions fail closed.

The implementation does not persist opponent IDs, coordinates, postcode, biography, source paths, duplicate-review details, or private profile fields. Public ranking snapshots select only `players.name` and the first available public avatar field (`photoThumbURL`, then `photoURL`, then `avatar`).

## Schema

Published month metadata:

- `activity_months/{monthKey}`: internal published pointer and counts; client reads and writes denied.
- `activity_leaderboards/{monthKey}`: public metadata, `publishedGenerationId`, counts, versions, checksum, generation timestamp; signed-in read only when published.

Generation data:

- `activity_months/{monthKey}/generations/{generationId}/players/{playerId}`: internal aggregate keyed logically by month and player. Fields include `eligibleActivityCount`, `cappedActivityCount`, `distinctOpponentCount`, `lastActivityAt`, `activityPoints`, `pointBreakdown`, calculation/scoring versions, source checksum, generation ID, and `updatedAt`.
- `activity_leaderboards/{monthKey}/generations/{generationId}/rankings/{playerId}`: client-facing row containing exactly `playerId`, `displayName`, `avatarUrl`, `rank`, `points`, `eligibleActivityCount`, `scoringActivityCount`, and `distinctOpponentCount`. Versions, checksums, generation timestamps, and generation IDs live on parent/generation metadata rather than ranking rows.

Run audit data:

- `activity_phase2_runs/{runId}` is a server-only record for one pilot or scheduled attempt. Live records contain `runId`, `month`, `triggerType`, `status`, `startedAt`, `completedAt`, `sourceChecksum`, `generationId`, source/scoring event counts, aggregate/ranking create and update counts, stale-row removal count, attempt/failure counts, `errorCategory`, calculation/scoring versions, and `recordOrigin: LIVE`.
- Audit records never contain player IDs, event IDs, source paths, opponent data, profile snapshots, or private fields. Normal clients cannot read or write this collection.
- Historical records additionally contain `recordOrigin: RECONSTRUCTED`, `reconstructedAt`, and a bounded `evidencePaths` list. Counters that cannot be proven from retained metadata are explicitly `null`.

`generationId` is deterministic: calculation version plus the first 20 hexadecimal characters of a SHA-256 checksum over stable normalized inputs. Firestore timestamps are added only to final persistence payloads and do not participate in checksums.

## Scoring v1

For each player and calendar month:

```text
cappedActivityCount = sum(min(matchesAgainstOpponent, 4))
activityPoints = 10 * cappedActivityCount + 5 * distinctOpponentCount
```

`eligibleActivityCount` is the uncapped raw activity metric. The four-per-opponent cap limits the advantage from repeatedly recording activity against one opponent while retaining the genuine raw count for analysis. The formula is fully reproducible from normalized events. Changes require a new scoring/calculation version and full affected-month rebuild.

Deferred and deliberately worth zero in v1: score-confirmation bonuses, streaks, first-opponent bonuses, geographic scopes, and profile-completeness filtering.

## Ranking and ties

Rows sort by:

1. points descending;
2. distinct opponents descending;
3. capped activity descending;
4. last activity descending;
5. player ID ascending as the final stable ordering key.

Displayed rank uses competition ranking (`1, 2, 2, 4`) and treats rows as tied when the first three metrics match. Recency and player ID determine deterministic build order but do not break the displayed tie. They are not published as additional fields because the approved public ranking-row allowlist is exact.

## Recalculation lifecycle

1. The scheduler selects at most three pending `activity_recalculation_requests/{monthKey}` documents per invocation and assigns a stable attempt ID from month plus attempt number. The pilot supplies its explicit pilot run ID.
2. A transaction claims a five-minute lease and creates `activity_phase2_runs/{runId}` as `RUNNING`. Both writes succeed or neither does. It rejects active competing leases, unsafe/reused run IDs, and requests carrying newer calculation/scoring versions.
3. The worker reads all normalized events for the month, validates scoring events, calculates a deterministic full-month result, and reads only approved public profile fields.
4. Aggregate and ranking rows are written with replacement semantics in batches of 400. Each batch has three bounded attempts.
5. A final transaction verifies lease and audit ownership, writes both generation metadata documents, flips both published pointers, marks the request `completed`, and replaces the audit with `COMPLETED` plus proven counts. These changes have one atomic commit boundary; an audit completion failure cannot leave the request completed or the new generation published.
6. Any calculation/staging/final-audit failure leaves the published pointer unchanged and atomically marks the owned request `failed` and audit `FAILED` with a coarse error category. If Firestore itself is unavailable for the failure transaction, neither record can be guaranteed to transition immediately, but the request is never incorrectly completed.
7. Reusing an already completed run ID with the same month and trigger is read-only and returns the verified deterministic calculation. Reusing it with conflicting scope fails closed. A new retry attempt receives a new run ID.

A new generation contains exactly the rebuilt rows, so stale rows are absent from the published result. Replaced generation metadata is atomically marked `retired` with `retiredAt` and `deleteAfter` set 30 days later. Retired documents remain server-only and unreadable through Firestore rules. A bounded daily cleanup schedule deletes expired retired generation trees, but uses the same disabled Phase 2 gate.

Both scheduled functions return without work unless the declared `ACTIVITY_PHASE2_ENABLED` parameter is true. The controlled deployment sets it explicitly to false.

The schedules run in `australia-southeast1` because Cloud Scheduler does not offer `australia-southeast2`; Firestore remains in `australia-southeast2`. The schedule timezone remains `Australia/Sydney`.

## Security model

- Client writes are denied for normalized events, internal aggregates, published rankings, and recalculation requests.
- All client reads and writes are denied for `activity_phase2_runs`.
- Internal month metadata, all aggregates, and retired ranking generations are unreadable to normal clients.
- Signed-in users can read a published leaderboard parent, its current published generation metadata, and current generation ranking rows.
- Anonymous reads are denied.
- No rule grants access to source event or duplicate-review details.

Emulator rule tests cover authenticated current-generation reads, anonymous denial, retired-generation denial, and mutation denial. Persistence tests verify server timestamps are accepted and private source profile fields are not copied into ranking rows.

## Validation record

- Functions TypeScript build: PASS.
- Activity Leaderboard unit suite: PASS, 72/72 after run-audit coverage was added.
- Firestore/Auth emulator integration and rules suite: PASS, 24/24 after run-audit lifecycle, reconstruction isolation, and security coverage was added.
- Targeted Phase 2 ESLint: PASS.
- `git diff --check`: see final task handoff after documentation validation.
- Production-derived preview: PASS, read-only; source manifest checksum `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7` and 37-document count matched.

Privacy-safe preview artifact: `activity-leaderboard-phase2-dry-run.json`.

| Month | Source events | Scoring events | Players/ranking rows | Pending duplicate events | Confirmed exclusions |
|---|---:|---:|---:|---:|---:|
| 2025-12 | 1 | 1 | 2 | 0 | 0 |
| 2026-02 | 2 | 2 | 3 | 0 | 0 |
| 2026-03 | 11 | 9 | 12 | 0 | 2 |
| 2026-04 | 8 | 5 | 10 | 2 | 1 |
| 2026-05 | 2 | 2 | 4 | 0 | 0 |
| 2026-06 | 1 | 1 | 2 | 0 | 0 |
| 2026-07 | 3 | 1 | 2 | 2 | 0 |

Data-quality notes: nine structurally ineligible events have no month and correctly produce no aggregate; four pending possible-duplicate events are non-scoring; three confirmed duplicate records are excluded; there are zero canonical conflicts and zero malformed scoring events. No current player is affected by the four-per-opponent cap.

## Rollback strategy

Before enabling processing, record current rules/function revisions. To stop processing, unset the enable flag or disable the schedule; an in-flight worker is protected by its lease and atomic publication transaction. To roll back a month, an approved Admin SDK operation can transactionally restore both parent pointers to a retained known-good generation and mark the associated request consistently. Never edit ranking rows in place. Rollback and retired-generation deletion are production writes and require separate approval.

## Approved controlled deployment order

1. Deploy and verify Firestore rules.
2. Deploy `recalculateDirtyActivityMonths` and `cleanupRetiredActivityGenerationsScheduled` with `ACTIVITY_PHASE2_ENABLED=false`.
3. Verify the runtime parameter and confirm neither schedule consumes a request or writes generated data.
4. Repeat the read-only preview and verify the Phase 1 source checksum remains unchanged.
5. Stop and request separate authorization for the guarded `2026-06` pilot command.
6. After pilot authorization, run only June, verify exact counts/rules/client rendering, and keep the general scheduler disabled until separately approved.

## Approved product decisions

- Scoring v1 is `10 * cappedActivityCount + 5 * distinctOpponentCount`, capped at four activities per opponent/month; raw eligible activity is uncapped.
- Competition rank and deterministic ordering use points, distinct opponents, capped activity, most recent qualifying activity, then stable player ID.
- Visibility is signed-in only.
- Public rows contain only the approved eight fields. Public display name/avatar refresh on every recalculation. No location, contact, birth, availability, skill, or private fields are copied.
- Retired generations are server-only for 30 days.
- The only approved pilot month is `2026-06`; executing it still requires separate authorization. The general scheduler remains disabled.

## Prepared June pilot invocation

Expected June source checksum: `70ffe0d27bb85de3c7b25ad3c56e180f0c21119cd8ea076b3b9f3d345c2a629a`.

From `functions/`, after separate written authorization:

```powershell
.\node_modules\.bin\tsx.cmd src\activityLeaderboard\runPhase2Pilot.ts --month=2026-06 --write --confirm-project=tennismate-d8acb --confirm-source-checksum=70ffe0d27bb85de3c7b25ad3c56e180f0c21119cd8ea076b3b9f3d345c2a629a
```

The command re-reads June, requires the request to remain `pending`, checks the checksum before confirmation and again inside the worker, and requires typing `tennismate-d8acb 2026-06 RECALCULATE`. It has not been executed.

## Controlled deployment record

Firestore rules:

- Active ruleset: `projects/tennismate-d8acb/rulesets/ae4f31e7-83e7-4336-a0de-c83b7062686f`.
- Released at `2026-07-19T03:47:54.354795Z`.
- Firebase compilation and release: PASS. Emulator authenticated/anonymous/current/retired/write-denial matrix: PASS.
- The compiler repeated three pre-existing warnings around the unused `conversationParticipant` helper; no Phase 2 rule warning or error occurred.
- Independent Rules API content-hash readback was unavailable because the current gcloud credential received HTTP 403. The Firebase release response and ruleset ID are the deployment verification evidence.

Functions:

- `recalculateDirtyActivityMonths`: ACTIVE, Node.js 22, `australia-southeast1`, every 15 minutes, `Australia/Sydney`, `ACTIVITY_PHASE2_ENABLED=false`; deployed update time `2026-07-19T04:01:05.533109218Z`.
- `cleanupRetiredActivityGenerationsScheduled`: ACTIVE, Node.js 22, `australia-southeast1`, daily at 03:30, `Australia/Sydney`, `ACTIVITY_PHASE2_ENABLED=false`; deployed update time `2026-07-19T04:01:08.065138467Z`.
- No Phase 2 function remains in `australia-southeast2`. Initial partial resources there were false-gated, had no valid scheduler, and were deleted before the supported-region deployment.
- A production-build output issue was corrected by setting the Functions TypeScript `rootDir` to `src` and excluding test files; `lib/index.js` was then verified to export both schedules before deployment.

Post-deployment read-only preview at `2026-07-19T04:03:21.556Z`:

- Phase 1 checksum unchanged: `a2afd180077d6564e4da43efd6b903ef74ae5c1a23a9bdfa26941f40e9a158d7`.
- 37 normalized events; 21 scoring-eligible.
- 7 recalculation requests; all 7 still `pending`; 0 non-pending.
- 0 `activity_months` parent documents and 0 `activity_leaderboards` parent documents.
- This confirms neither deployed schedule consumed a request or published Phase 2 data.

### Deployment rollback

The processing kill switch is already false. If the deployed Phase 2 surface must be removed, delete only the two functions in `australia-southeast1`; this also removes their Firebase-managed scheduler jobs. Restore a reviewed prior Firestore ruleset through the Firebase Rules release API/console, or redeploy the prior reviewed rules source. The verified June generation must remain untouched unless a separately approved June rollback explicitly changes both published pointers atomically; all other requests remain pending.

## June run-audit reconstruction preparation

The completed June generation is valid and must not be recalculated. The one-time utility `reconstructPhase2JuneAudit.ts` reads only these verified evidence documents:

- `activity_recalculation_requests/2026-06`
- `activity_months/2026-06`
- `activity_months/2026-06/generations/v1-70ffe0d27bb85de3c7b2`
- `activity_leaderboards/2026-06`
- `activity_leaderboards/2026-06/generations/v1-70ffe0d27bb85de3c7b2`

It validates completed/published states, matching pointers, run ID, versions, and the exact verified checksum before offering an interactive write. Its only possible write is a create-only transaction at `activity_phase2_runs/phase2-pilot-2026-06-1784436876993`; a matching existing reconstruction is an idempotent no-op and a conflicting document fails closed. It does not import or call recalculation code.

After separate production authorization, from `functions/`:

```powershell
$env:ACTIVITY_PHASE2_AUDIT_RECONSTRUCTION_ENABLED='true'
.\node_modules\.bin\tsx.cmd src\activityLeaderboard\reconstructPhase2JuneAudit.ts --month=2026-06 --write --confirm-project=tennismate-d8acb --confirm-source-checksum=70ffe0d27bb85de3c7b25ad3c56e180f0c21119cd8ea076b3b9f3d345c2a629a
```

The command first prints a read-only evidence preview, then requires typing `tennismate-d8acb 2026-06 RECONSTRUCT AUDIT`. The controlled execution environment could not attach an interactive stdin TTY, so the approved execution used the utility's exact-match automation confirmation environment variable after the TTY attempt failed before launching the utility. All other write guards remained active.

## Controlled run-audit deployment and reconstruction record

Execution date: 2026-07-19 UTC.

Firestore rules:

- Active ruleset: `projects/tennismate-d8acb/rulesets/fa0667c8-2dae-4812-a524-fd0aa0cb3180`.
- Release update time: `2026-07-19T05:32:14.318560Z`.
- Firebase compilation and release: PASS. The only compiler warnings were the three pre-existing `conversationParticipant` warnings; there was no Phase 2 warning or error.
- The released source contains `match /activity_phase2_runs/{runId} { allow read, write: if false; }`. An unauthenticated production REST read returned HTTP 403; authenticated denial is also unconditional in the released rule and covered by the Firestore rules emulator test.

Functions:

- `projects/tennismate-d8acb/locations/australia-southeast1/functions/recalculateDirtyActivityMonths`: ACTIVE, Node.js 22, revision `recalculatedirtyactivitymonths-00002-piv`, update time `2026-07-19T05:34:35.412492089Z`, `ACTIVITY_PHASE2_ENABLED=false`.
- `projects/tennismate-d8acb/locations/australia-southeast1/functions/cleanupRetiredActivityGenerationsScheduled`: ACTIVE, Node.js 22, revision `cleanupretiredactivitygenerationsscheduled-00002-den`, update time `2026-07-19T05:34:44.919752342Z`, `ACTIVITY_PHASE2_ENABLED=false`.
- All-region inventory returned exactly these two Phase 2 functions, both in `australia-southeast1`; no unsupported-region resource was created.
- Scheduler jobs remain enabled as schedules but processing-inert behind the false flag. Six non-June requests remain `pending` with zero attempts.

June reconstruction:

- Created document: `activity_phase2_runs/phase2-pilot-2026-06-1784436876993`.
- `recordOrigin=RECONSTRUCTED`, `status=COMPLETED`, reconstructed Admin timestamp `2026-07-19T05:38:58.895Z`.
- Month, run ID, original timestamps, generation, checksum, source/scoring counts, attempt count, calculation/scoring versions, and five evidence paths matched the approved preview.
- Unprovable aggregate/ranking CRUD, stale-row, and failure counters remain `null`.
- Approved-field allowlist: PASS. Raw player/event identifier matches: 0.
- Pre/post content hashes for all recalculation requests, 37 Phase 1 events, the full `activity_months` tree, and the full `activity_leaderboards` tree were unchanged. The audit collection changed from zero documents to exactly the one approved record.
- Runtime log scan: zero errors, failed writes, retries, sensitive terms, or UID-shaped values for both Phase 2 services.

Privacy-safe evidence artifacts:

- `activity-phase2-audit-reconstruction-baseline.json`
- `activity-phase2-audit-reconstruction-post-run.json`

## Controlled May 2026 pilot record

Execution date: 2026-07-19 UTC. The pilot runner was locally locked to `2026-05`, required the exact project and checksum, required `ACTIVITY_PHASE2_ENABLED=false`, rejected emulator environments, verified the request was pending at attempt zero, and rejected any pre-existing May parent, pointer, generation, or run-audit state. The controlled tool channel could not attach interactive stdin, so execution used the tested exact-match automation phrase `tennismate-d8acb 2026-05 RECALCULATE` after displaying the complete confirmation payload.

- Run ID: `phase2-pilot-2026-05-1784440578482`.
- Audit path: `activity_phase2_runs/phase2-pilot-2026-05-1784440578482`.
- Audit lifecycle observed by the runner: `RUNNING`, then `COMPLETED`.
- Audit origin/trigger: `LIVE` / `pilot`.
- Started: `2026-07-19T05:56:18.218Z`; completed: `2026-07-19T05:56:18.617Z`.
- Source checksum: `73de8141888ba6f3a34a8397ca36776716d844d9195adb82bf5047749344334b`.
- Published generation: `v1-73de8141888ba6f3a34a`.
- Source/scoring events: 2/2. Aggregate/ranking rows: 4/4. Total published points: 60.
- Audit write counts: 4 aggregate creates, 0 aggregate updates, 4 ranking creates, 0 ranking updates, 0 stale-row removals; attempt count 1, failure count 0.
- Calculation/scoring versions: 1/1.
- Reconciliation: zero aggregate discrepancies, leaderboard discrepancies, stale rows, or missing rows. Public profile snapshots matched current public profiles and every public row had the exact approved field set.
- Privacy: exact LIVE audit allowlist passed; zero player/event/source identifier matches; no forbidden aggregate or leaderboard fields.
- Isolation: all 37 Phase 1 events, June data and reconstructed audit, the five other requests, and every non-May aggregate/leaderboard/audit scope matched pre-run hashes. The five other requests remained pending at attempt zero.
- Scheduler safety: both deployed services remained ACTIVE with `ACTIVITY_PHASE2_ENABLED=false`; the recalculation scheduler's `2026-07-19T05:46:00.803066Z` invocation was inert.
- Logs: zero runtime errors, failed writes, retry terms, sensitive terms, or UID-shaped values for both Phase 2 services.

Privacy-safe artifacts:

- `activity-leaderboard-phase2-may-preview.json`
- `activity-phase2-may-pilot-baseline.json`
- `activity-phase2-may-post-run-verification.json`
- `activity-phase2-post-may-global-state.json`

## Remaining-month controlled rollout

Each row below represents a separate guarded execution followed by read-only reconciliation, privacy validation, and pre/post isolation hashing. Scheduled processing remained disabled throughout.

| Month | Run ID | Checksum | Generation | Source/scoring | Rows | Duplicate state | Result |
|---|---|---|---|---:|---:|---|---|
| 2025-12 | `phase2-pilot-2025-12-1784441352740` | `c13a59172a29b58388b3a17cf95e8c3bd2f307106408ef414f4441e7a0c3e1c8` | `v1-c13a59172a29b58388b3` | 1/1 | 2/2 | pending 0, excluded 0 | PASS |
| 2026-02 | `phase2-pilot-2026-02-1784441466708` | `9f42508ac08d29da1921022d5b5e9bc63211445980ac42255faff1bc47696867` | `v1-9f42508ac08d29da1921` | 2/2 | 3/3 | pending 0, excluded 0 | PASS |
| 2026-03 | `phase2-pilot-2026-03-1784441584913` | `add3e5b76fadb6ff8785436c88d429d8b26bd0ab0caaaa1b688455b3e08f8ccc` | `v1-add3e5b76fadb6ff8785` | 11/9 | 12/12 | pending 0, excluded 2 | PASS |
| 2026-04 | `phase2-pilot-2026-04-1784441746409` | `e48d9282fdab9c5d9f5bc4ec441a159b94b91dc6087502bc6eccdf9b79815215` | `v1-e48d9282fdab9c5d9f5b` | 8/5 | 10/10 | pending 2, excluded 1 | PASS |
| 2026-07 | `phase2-pilot-2026-07-1784441879229` | `9f8ccdd6999640ab687140b10a87e8b07526795644553268229f87816b65f49c` | `v1-9f8ccdd6999640ab6871` | 3/1 | 2/2 | pending 2, excluded 0 | PASS |

`2025-12` audit: `activity_phase2_runs/phase2-pilot-2025-12-1784441352740`, LIVE pilot, RUNNING observed before COMPLETED, 2 aggregate creates, 2 ranking creates, 0 updates/stale removals/failures, attempt 1, versions 1/1, strict audit allowlist and identifier privacy checks passed. Aggregate/ranking reconciliation and all isolation hashes passed.

`2026-02` audit: `activity_phase2_runs/phase2-pilot-2026-02-1784441466708`, LIVE pilot, RUNNING observed before COMPLETED, 3 aggregate creates, 3 ranking creates, 0 updates/stale removals/failures, attempt 1, versions 1/1, strict audit allowlist and identifier privacy checks passed. Aggregate/ranking reconciliation and all isolation hashes passed.

`2026-03` audit: `activity_phase2_runs/phase2-pilot-2026-03-1784441584913`, LIVE pilot, RUNNING observed before COMPLETED, 12 aggregate creates, 12 ranking creates, 0 updates/stale removals/failures, attempt 1, versions 1/1, strict audit allowlist and identifier privacy checks passed. Two confirmed duplicate events remained excluded, aggregate/ranking reconciliation passed, and all isolation hashes passed.

`2026-04` audit: `activity_phase2_runs/phase2-pilot-2026-04-1784441746409`, LIVE pilot, RUNNING observed before COMPLETED, 10 aggregate creates, 10 ranking creates, 0 updates/stale removals/failures, attempt 1, versions 1/1, strict audit allowlist and identifier privacy checks passed. Two pending duplicate events followed their current eligibility and one confirmed duplicate remained excluded. Aggregate/ranking reconciliation and all isolation hashes passed.

`2026-07` audit: `activity_phase2_runs/phase2-pilot-2026-07-1784441879229`, LIVE pilot, RUNNING observed before COMPLETED, 2 aggregate creates, 2 ranking creates, 0 updates/stale removals/failures, attempt 1, versions 1/1, strict audit allowlist and identifier privacy checks passed. Two pending duplicate events followed their current eligibility. Aggregate/ranking reconciliation and all isolation hashes passed.

### Seven-month global verification

The final production read-only reconciliation at `2026-07-19T06:20:32.237Z` passed for `2025-12`, `2026-02`, `2026-03`, `2026-04`, `2026-05`, `2026-06`, and `2026-07`.

- All seven recalculation requests are `completed` at attempt 1; there are zero pending, running, or failed requests.
- There are exactly seven aggregate month pointers and seven leaderboard month pointers. Each pair references the same expected generation and uses calculation version 1 and scoring version 1.
- The verified source remains 37 Phase 1 event documents: 28 have one of the seven published month keys and 21 are scoring eligible.
- Recalculation found zero aggregate discrepancies, leaderboard discrepancies, stale rows, or missing rows.
- Exactly seven completed audits exist: six LIVE records and the approved reconstructed June record.
- No retired aggregate or leaderboard generation exists because no published month was rerun.
- Runtime review for the two Phase 2 services found zero errors, failed writes, unexpected retries, application-logged sensitive terms, or application-logged UID-shaped values. Scheduled recalculation invocations returned successfully and remained inert behind `ACTIVITY_PHASE2_ENABLED=false`; cleanup had no rollout-window invocation.
- Privacy-safe evidence: `activity-phase2-global-seven-month-reconciliation.json` plus the `activity-phase2-<month>-baseline.json`, `activity-phase2-<month>-preview.json`, and `activity-phase2-<month>-post-run.json` artifacts for each remaining-month execution.

## Phase 3 client UI and read integration

Implementation date: 2026-07-19 UTC. Scope is local client implementation, read-only production validation, and preview preparation. No Phase 1/2 calculation code, scoring rules, derived data, recalculation request, generation, or scheduler gate was changed.

### Route and component structure

- Route: `/activity-leaderboard`, implemented by `app/activity-leaderboard/page.tsx` and `ActivityLeaderboardClient.tsx`.
- Dashboard entry point: `LeaderboardEntryCard` appears before Quick Actions on both mobile and desktop home experiences. It is visually distinct but secondary to matchmaking and upcoming-game actions.
- Ranking display: `LeaderboardRows` and `LeaderboardRow` provide mobile-first rows, shared-rank labels, top-three treatments, current-user highlighting, public avatar fallback, and compact activity/opponent statistics.
- Pure validation/presentation rules live in `lib/activityLeaderboardModel.ts`; the bounded Firestore reader and five-minute promise cache live in `lib/activityLeaderboardClient.ts`.

### Read model and month behaviour

The client queries at most 24 `activity_leaderboards` parent documents constrained to `status == "published"`, sorts their month keys locally, and defaults to the newest published month at or before the current calendar month. A valid requested `?month=YYYY-MM` is retained so an unpublished month receives the explicit unavailable state rather than silently displaying another month.

For the selected month, the client reads its parent pointer and then only `activity_leaderboards/{monthKey}/generations/{publishedGenerationId}/rankings`. It reads at most 100 rows and, if necessary, one additional published row keyed by the signed-in user for the compact “Your position” card. Results are reused for five minutes. The reader never constructs a path or query for profiles, events, aggregates, duplicate state, recalculation requests, run audits, or retired generations.

The initial display is the top 10 with an accessible Show all control. If the current user is below the initial range, their row also appears in “Your position.” If absent, the page explains how confirmed eligible activity can appear after a future publication. Public ties retain competition ranks such as `1, 2, 2, 4`; tied rows are labelled without implying negative performance.

### Privacy and states

Rows are reduced to the exact approved fields: player ID, display name, avatar URL, rank, points, eligible activity count, scoring activity count, and distinct opponent count. Malformed rows fail closed and are omitted. No postcode, coordinates, email, birth data, availability, skill, private profile field, eligibility reason, duplicate-review state, source path, or event identifier is fetched or rendered.

The client also omits a published row when its display-name snapshot is exactly `Test`, case-insensitive and ignoring surrounding whitespace. This is a display-only product exclusion: it does not query a private profile, alter published data, renumber ranks, or match legitimate names containing that text. The production read-only scan found one affected July 2026 row and none in the other six months.

Loading, empty, unpublished/unavailable, permission/network error, malformed-row, current-user-present, current-user-outside-range, and current-user-absent states have explicit UI. The points disclosure explains 10 points per scoring activity, 5 per distinct opponent, the four-activities-per-opponent monthly cap, raw versus scoring activity, and confirmation/review delays without revealing private decisions.

Security validation used the unchanged Firestore rules. The Firestore/Auth emulator passed signed-in current-generation reads, unsigned denial, retired-generation denial, and write denial. A direct unsigned production REST read returned HTTP 403.

### Responsive visual notes

- Mobile: a compact hero, 44-pixel avatars, three-column rows for rank/player/points, wrapped secondary statistics, no horizontal scrolling, and 44-pixel minimum controls.
- Top three: warm gold, silver, and bronze surfaces. Current-user rows add an emerald ring and “You” badge, including when a top-three surface is present. Shared ranks show a small “Tied” label.
- Desktop: content remains centred at `max-w-3xl`, preventing a sparse full-width table while preserving the same scan order and touch-friendly controls.
- Empty/error panels use neutral, encouraging language; lower ranks have no warning or failure styling.

### Validation and preview status

- Phase 3 UI/model/privacy tests: 11 passed, including the exact-name `Test` exclusion and non-matching real-name cases.
- Full Next.js production build: PASS; `/activity-leaderboard` generated successfully.
- Firestore/Auth emulator security tests: PASS on isolated local ports because two existing emulator processes occupied the repository defaults.
- Production read-only compatibility manifest: `activity-leaderboard-phase3-production-read-validation.json`, PASS for all seven published months with stored row counts `2, 3, 12, 10, 4, 2, 2`, exact public field allowlists, zero malformed rows, and zero retired generations. The client-visible July count is 1 after the approved `Test` display exclusion.
- Targeted ESLint and `git diff --check`: PASS.
- Preview URL: pending. The non-production Vercel preview command was rejected by the workspace external-code-export policy before upload. Explicit approval to export the private application source to Vercel is required before retrying; no preview or production deployment occurred.
