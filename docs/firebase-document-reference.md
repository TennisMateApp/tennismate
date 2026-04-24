# Firebase Document Reference

## Scope

This document covers the Firebase/Firestore document types that are created by this codebase.

- Included: client-side app writes, Cloud Function writes, and the `postcodes` admin import script.
- Excluded: collections that are only read in the repo or whose creation path was not found here.
- Important: many of these docs are later updated with more fields over time. The "Data provided" column focuses on the fields written at creation time and the purpose of the document.

## Runtime App Documents

| Document path | Where and when it is created | Related to | Data provided |
| --- | --- | --- | --- |
| `users/{uid}` | Created during signup in `app/signup/page.tsx` when a user completes registration. Later merged by profile/coach flows. | Firebase Auth user / account record. | Account-level profile and control data like `name`, `email`, `photoURL`, `photoThumbURL`, `requireVerification`, `createdAt`. Later also stores role and lifecycle fields like `verifiedAt`, `coachActivatedAt`, `firstMatchAcceptedAt`. |
| `players/{uid}` | Created during supported-region signup in `app/signup/page.tsx`, and can also be bootstrapped on Google login in `app/login/page.tsx`. | The player's public/matchable profile tied to a user. | Player-facing data such as `name`, `nameLower`, `email`, `postcode`, `gender`, `birthYear`, `lat`, `lng`, `geohash`, `skillRating`, `utr`, `skillBand`, `skillBandLabel`, `availability`, `bio`, photos, `profileComplete`, `isMatchable`, timestamps. |
| `waitlist_users/{uid}` | Created in `app/signup/page.tsx` when the signup postcode is outside the supported region. | Unsupported-region signups / waitlist funnel. | Basic lead capture: `name`, `email`, `postcode`, `timestamp`, `source`. |
| `coaches/{uid}` | Created if missing from `app/coach/profile/page.tsx` or `app/profile/ProfileContent.tsx` when a user activates coach mode. | Coach directory/profile record for a user. | Coach listing/profile data: `userId`, `name`, `avatar`, `mobile`, `contactFirstForRate`, `coachingExperience`, `bio`, `playingBackground`, `courtAddress`, `coachingSkillLevels`, `galleryPhotos`, location fields, `status`, `createdAt`, `updatedAt`. |
| `coaches/{coachId}/viewers/{uid}` | Created in `app/coaches/page.tsx` when a logged-in player views a coach profile for the first time. | Coach profile analytics. | Viewer identity snapshot and timing: `viewerUid`, `viewerName`, `viewerPostcode`, `firstViewedAt`, `lastViewedAt`. |
| `coaches/{coachId}/uniqueClicks/{uid_dayKey}` | Created in `app/coaches/page.tsx` once per viewer per day when a coach profile is viewed. | Coach traffic analytics. | Daily unique-click marker with `viewerUid`, `dayKey`, `createdAt`. |
| `coach_contact_events/{autoId}` | Created from `app/coaches/page.tsx` and `app/coaches/[id]/page.tsx` when a user taps call/text on a coach profile. | Coach lead/contact tracking. | Contact intent data: `action`, `coachId`, `viewerUid`, `phoneProvided`, `createdAt`, `source`. |
| `availabilities/{uid}` | Created or upserted in `app/match/page.tsx` when a player posts availability. | Open match availability for one user. | Current availability listing: `instanceId`, `userId`, `status`, `date`, `timeSlot`, `postcode`, `radiusKm`, `matchType`, `note`, profile snapshot fields, skill fields, geo fields, `createdAt`, `updatedAt`, `expiresAt`. |
| `match_requests/{matchId}` | Created from several match/rematch entry points including `app/match/page.tsx`, `app/matches/page.tsx`, `components/players/PlayerProfileView.tsx`, and rematch flows. | 1:1 match challenges between players. | Match request lifecycle and UI snapshot fields such as `fromUserId`, `toUserId`, `status`, `createdAt`/`timestamp`, optional `acceptedAt`, names, postcodes, photos, request context, and later score/completion fields. |
| `notifications/{notifId or autoId}` | Created from client flows for match requests, rematches, event join actions, coach flows, and messaging; also heavily created by Cloud Functions. | In-app bell notifications and some push/email orchestration. | Recipient-targeted notification payloads like `recipientId`, `fromUserId`, `type`, related ids such as `matchId`/`eventId`/`conversationId`, message/title/body text, `route`/`url`, timestamps, `read`, `source`. |
| `conversations/{conversationId}` | Created in `app/messages/[conversationID]/page.tsx` for 1:1 chats if missing, and in `lib/conversations.ts` for event group chats. | Message threads between 2 players or an event group. | Conversation metadata: `participants`, `createdAt`, `updatedAt`, `typing`, `lastRead`, optional `context` for event chats, plus match-prompt state such as `matchIntentAt`, `activeMatchId`, `matchCheckInResolved`. |
| `conversations/{conversationId}/messages/{messageId}` | Created in `app/messages/[conversationID]/page.tsx` when a user sends a direct message or match invite, and in `components/invites/InviteOverlayCard.tsx` / `app/invites/[inviteId]/page.tsx` for invite follow-up system messages. | Individual chat messages inside a conversation. | Message payloads such as `senderId`, `recipientId`, `text`, `timestamp`, `read`, or invite-specific data like `type: "invite"`, embedded `invite` details, `inviteStatus`, `inviteId`, booking flags. |
| `match_invites/{inviteId}` | Created in `app/messages/[conversationID]/page.tsx` when a user sends a match invite from chat. | Structured invite record for a chat invite. | Stable invite detail document with `inviteId`, `conversationId`, `messageId`, `fromUserId`, `toUserId`, full `invite` payload, `inviteStatus`, booking status fields, `createdAt`, `updatedAt`. |
| `calendar_events/{docId}` | Created in `app/events/[id]/page.tsx` for event attendance sync, and from accepted match invites via client/function sync. Doc ids are typically `${eventId}_${uid}` or `${inviteId}_${uid}`. | User calendar entries derived from events or accepted invites. | Calendar-facing data like `eventId`, optional `inviteId`, `ownerId`, `title`, `start`, `end`, `participants`, `status`, `visibility`, `courtName`, `conversationId`, `messageId`, `createdAt`, `source`. |
| `events/{eventId}` | Created in `app/events/new/page.tsx` or `components/events/DesktopCreateEventPage.tsx` when a host publishes an event. | Social tennis event listing. | Event metadata: `hostId`, `visibility`, `title`, `type`, `location`, `court`, `start`, `end`, `durationMins`, `description`, skill range labels, `spotsTotal`, `spotsFilled`, `status`, `createdAt`, `updatedAt`. |
| `events/{eventId}/join_requests/{reqId}` | Created in `app/events/[id]/page.tsx` when a player requests to join an event. | Player join workflow for an event. | Request state with `userId`, `status`, `createdAt`, and later `updatedAt` plus email-notified markers written by functions. |
| `events/{eventId}/chat/{messageId}` | Created in `components/EventChat.tsx` when someone posts into the event chat subcollection. | Lightweight event chat stream. | Minimal chat payload: `text`, `userId`, `createdAt`. |
| `support_feedback/{autoId}` | Created in `app/support/page.tsx` when a user submits support feedback. | Support/contact submissions. | Support payload including `topic`, `message`, optional `email`, `name`, `uid`, `userAgent`, `page`, `createdAt`. |
| `court_clicks/{uid_courtId}` | Created/upserted in `app/courts/page.tsx` and `app/matches/page.tsx` when a user taps a court booking/map link. | Court engagement analytics per user/court pair. | Counter document with `userId`, `courtId`, `updatedAt`, `totalClicks`, plus either `mapClicks` or `bookingClicks`. |
| `match_history/{historyId}` | Created in match completion/check-in flows such as `components/matches/MatchCheckInOverlay.tsx`, `app/matches/[id]/summary/page.tsx`, and `app/matches/[id]/complete/details/page.tsx`. | Archived record of played or not-played matches. | Historical match snapshot including player ids/names/photos, score/sets/winner, completion state, outcome, location/court, conversation/invite references, match metadata, timestamps. |
| `match_scores/{scoreId}` | Created in `components/matches/MatchCheckInOverlay.tsx` and `app/matches/[id]/complete/details/page.tsx` when a score is saved. | Structured score storage separate from request/history docs. | Compact score data like `players`, `sets`, `winnerId`, and timestamps. |
| `completed_matches/{docId}` | Created in summary/check-in flows after a match is completed. Sometimes uses the match id, sometimes an auto id. | Lightweight "completed match happened" marker used by downstream logic. | Minimal completion summary: `matchId`, `winnerId`, `fromUserId`, `toUserId`, `timestamp`. |
| `match_feedback/{matchId_uid}` | Created in `app/matches/[id]/summary/page.tsx` as a placeholder and then filled from `app/matches/[id]/feedback/page.tsx`. | Per-user post-match feedback. | Feedback data such as `matchId`, `userId`, `enjoyment`, `skillMatch`, `wouldPlayAgain`, `punctual`, `comments`, `createdAt`, `updatedAt`, `submittedAt`. |
| `device_tokens/{id}` | Created in `components/PushPermissionPrompt.tsx` and `lib/nativePush.ts`. The id is inconsistent: sometimes `uid`, sometimes the raw push token. | Push token debugging / token capture. | Token diagnostics like `uid`, `token`, `platform`, `apnsOrNativeToken`, `fcmToken`, `createdAt` or `seenAt`. |
| `users/{uid}/devices/{token}` | Created in `lib/nativePush.ts` when a signed-in device registers for native/FCM push. | User-owned push endpoints. | Device binding data: `platform`, `fcmToken`, `apnsOrNativeToken`, `lastSeen`, `prefersNativePush`. |

## Server-Generated Documents

| Document path | Where and when it is created | Related to | Data provided |
| --- | --- | --- | --- |
| `notifications/{notifId}` | Created by Cloud Functions in `functions/src/index.ts` and `functions/src/matchEvents.ts` when new messages, match invites, event join requests, accepted event joins, cancelled events, match requests, or match-event changes occur. | Server-side notification fan-out. | Canonical notification docs with stable ids, recipient routing fields, related ids, human-readable message fields, `timestamp`/`createdAt`, `read`, and `source` markers showing which function created them. |
| `calendar_events/{docId}` | Created by functions in `functions/src/index.ts` for event creation/host backfill and accepted invite sync. | Server-side calendar sync. | Same purpose as client-created `calendar_events`, but includes server provenance like `source: "cf:..."` and invite/event linkage fields. |
| `mail/{autoId}` | Created by `enqueueEmail` in `functions/src/index.ts` and `functions/src/eventReminders.ts`. | Firebase extension email queue. | Email job payloads: `to`, `message.subject`, `message.html`, `message.text`, optional meta tags, `createdAt`. |
| `event_reminder_sends/{eventId_type}` | Created in `functions/src/eventReminders.ts` after a reminder email batch is sent. | De-duplication log for 24h/1h event reminder sends. | Reminder log data: `eventId`, `type`, `sentAt`. |

## Seed / Admin-Created Documents

| Document path | Where and when it is created | Related to | Data provided |
| --- | --- | --- | --- |
| `postcodes/{postcode}` | Created by the admin import script `scripts/import-postcodes.js`. | Postcode lookup and geocoding support. | Postcode reference data used across signup/profile/matching, including postcode metadata and geo fields like `lat` and `lng`. |

## Collections Referenced But Creation Source Was Not Found Here

- `courts`
  Read throughout the app, but I did not find a court creation flow in this repo.
- `match_events`
  Cloud Functions react to this collection in `functions/src/matchEvents.ts`, but I did not find where those docs are created.
- `referral_stats`
  Read in the app, but no creation path was found in the scanned code.

## Main Source Files

- `app/signup/page.tsx`
- `app/login/page.tsx`
- `app/match/page.tsx`
- `app/messages/[conversationID]/page.tsx`
- `app/events/new/page.tsx`
- `app/events/[id]/page.tsx`
- `app/matches/[id]/summary/page.tsx`
- `app/matches/[id]/feedback/page.tsx`
- `components/matches/MatchCheckInOverlay.tsx`
- `app/coach/profile/page.tsx`
- `app/coaches/page.tsx`
- `app/coaches/[id]/page.tsx`
- `app/support/page.tsx`
- `app/courts/page.tsx`
- `components/PushPermissionPrompt.tsx`
- `lib/nativePush.ts`
- `lib/conversations.ts`
- `functions/src/index.ts`
- `functions/src/matchEvents.ts`
- `functions/src/eventReminders.ts`
- `scripts/import-postcodes.js`
