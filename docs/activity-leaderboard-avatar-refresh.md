# Activity Leaderboard avatar refresh

## Publication policy

- Published ranking rows remain self-contained and keep an `avatarUrl` snapshot. The web client must not read live player profiles for leaderboard rendering.
- A successful profile update queues only the current Activity month, calculated in `Australia/Melbourne`.
- Historical months do not change merely because a player changes their photo.
- A historical month may be regenerated when the read-only avatar audit confirms that one or more persisted URLs return HTTP 404 or 410.
- Network errors, timeouts, authentication responses and 5xx responses are transient audit failures. They do not by themselves authorise regeneration.
- Avatar-only regeneration must preserve the scoring checksum and every public scoring field. A changed profile snapshot creates a new generation so the prior generation follows the existing retirement and rollback path.

## Read-only audit

All published months:

```powershell
npm run audit:activity-leaderboard-avatars
```

One month with a privacy-safe JSON report:

```powershell
npm run audit:activity-leaderboard-avatars -- --month=2026-07 --output=activity-avatar-audit-2026-07.json
```

The report contains month-level counts only. It never emits player IDs, names, URLs or download tokens. A month is recommended for regeneration only when at least one URL is confirmed as 404 or 410.

## Controlled July 2026 regeneration

Do not perform these production-write steps without an approved release window and an explicit operator confirmation.

1. Run the July audit above. Stop if `brokenAvatars` is zero or if failures are transient only.
2. Record the current `activity_leaderboards/2026-07.publishedGenerationId`, generation metadata, source checksum, ranking count and the public scoring fields (`rank`, `points`, `eligibleActivityCount`, `scoringActivityCount`, `distinctOpponentCount`) for comparison and rollback.
3. Confirm the trusted Functions release containing `refreshActivityAvatarOnPlayerPhotoUpdate` and the profile-aware generation identity is deployed, and confirm `ACTIVITY_PHASE2_ENABLED` is enabled.
4. In an authenticated administrator session, update `activity_recalculation_requests/2026-07` through the existing request model: set `status` to `pending`, retain existing `sourceEventIds`, add the bounded reason `PROFILE_AVATAR_REPAIR`, and update `updatedAt`. Do not write a leaderboard row or pointer directly.
5. Allow `recalculateDirtyActivityMonths` to process the request. This is the guarded path: it uses a lease, a new run audit, staged writes, checksum validation and an atomic pointer publication. Do not use `runPhase2Pilot`; that command correctly refuses an already-published month.
6. Verify the request and new `activity_phase2_runs` record completed, the published pointer targets the new generation, and the source checksum is identical to the baseline.
7. Compare all public scoring fields and totals with the baseline. They must be unchanged. Stop and restore the old pointer if any scoring value differs.
8. Run the July avatar audit again. Confirm `brokenAvatars` is zero and transient failures are zero. Separately perform a privacy-safe comparison confirming the affected published avatar equals the current valid player photo URL.
9. Confirm the previous generation is marked `retired` with its normal `deleteAfter` timestamp. Keep it available for rollback until the retirement window expires.

Rollback consists of atomically restoring both July parent pointers to the recorded prior generation and removing its retirement marker under an approved incident procedure. Never delete the replacement generation during diagnosis.
