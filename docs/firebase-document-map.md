# Firebase Document Map

This is the quick version of [firebase-document-reference.md](./firebase-document-reference.md).

## Accounts And Profiles

- `users/{uid}`: account-level user doc.
- `players/{uid}`: player profile and matchability data.
- `waitlist_users/{uid}`: unsupported-region signup capture.
- `coaches/{uid}`: coach directory/profile doc.
- `users/{uid}/devices/{token}`: push-enabled devices for a signed-in user.
- `device_tokens/{id}`: debug/raw token capture.

## Match Flow

- `availabilities/{uid}`: open availability posted by a player.
- `match_requests/{matchId}`: pending/accepted/completed match challenge.
- `match_history/{historyId}`: archived match outcome snapshot.
- `match_scores/{scoreId}`: structured set scores.
- `completed_matches/{docId}`: lightweight completion marker.
- `match_feedback/{matchId_uid}`: post-match rating/comments from one user.
- `match_invites/{inviteId}`: structured invite sent from chat.

## Messaging

- `conversations/{conversationId}`: 1:1 or event group thread.
- `conversations/{conversationId}/messages/{messageId}`: direct message or invite message payload.
- `notifications/{notifId}`: in-app notification docs, created by both app code and functions.

## Events

- `events/{eventId}`: tennis event listing.
- `events/{eventId}/join_requests/{reqId}`: join request for an event.
- `events/{eventId}/chat/{messageId}`: lightweight event chat message.
- `calendar_events/{docId}`: user calendar entry for an event or accepted invite.
- `event_reminder_sends/{eventId_type}`: reminder send log.
- `mail/{autoId}`: queued email job for the Firebase email extension.

## Coach And Court Analytics

- `coaches/{coachId}/viewers/{uid}`: first/last coach profile viewer snapshot.
- `coaches/{coachId}/uniqueClicks/{uid_dayKey}`: daily unique coach click marker.
- `coach_contact_events/{autoId}`: coach call/text click tracking.
- `court_clicks/{uid_courtId}`: map/booking click counters per user and court.

## Seed/Admin Data

- `postcodes/{postcode}`: imported postcode lookup data.

## Not Found In This Repo

- `courts`: read everywhere, but no creation flow found here.
- `match_events`: functions react to it, but no creation flow found here.
- `referral_stats`: referenced, but no creation flow found here.
