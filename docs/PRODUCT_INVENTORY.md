# TennisMate Product Inventory

This inventory groups the currently observed TennisMate functionality by product area. It is based on the current codebase, Firestore rules, Firebase Functions, and supporting documentation in this repository.

## 1. Onboarding

### Implemented Features

- Email/password signup and login.
- Google login support.
- Email verification gate before app access.
- Forgot password flow.
- Profile bootstrap during signup.
- Supported postcode lookup during signup.
- Basic waitlist capture for unsupported regions.
- Required profile fields for matchability, including name, postcode, gender, skill, availability, and birth year/private data split.
- Redirect handling after auth.
- Terms, privacy, and referral competition legal pages.

### Partially Implemented Features

- Waitlist capture exists in UI/code but `waitlist_users` is not covered by Firestore rules, so client writes may fail.
- Birth year/age gate exists but broader safety or age-policy enforcement is limited.
- Google login can bootstrap profile docs, but onboarding completeness is spread across login, signup, profile, and auth gate code.
- Referral-aware signup links exist in UI/route patterns, but attribution is not fully wired end to end.

### Missing Features

- Dedicated onboarding checklist.
- Admin review of waitlist users.
- Region expansion workflow.
- Explicit onboarding analytics funnel.
- SMS/phone verification.
- Account recovery beyond email reset.
- In-product explanation for verification or blocked unsupported-region states.

## 2. Profiles

### Implemented Features

- Player profile creation and editing.
- Public/private profile data split using `players` and `players_private`.
- Profile photos and thumbnail/fallback handling.
- Skill band, UTR, availability, bio, gender, postcode, location, and profile completeness fields.
- Public player profile view.
- Desktop and mobile profile views.
- Coach profile activation from player profile.
- Coach profile editing with avatar, gallery, phone, experience, background, skill levels, court/location fields, and status.
- Account deletion callable.
- Coach profile deletion callable.

### Partially Implemented Features

- Coach profile exists as a directory listing, but there is no approval, moderation, subscription, or verification system.
- Profile completeness is used, but there is no centralized profile quality score.
- Player public stats are computed server-side, but surfaced only in limited profile contexts.
- Account deletion cleans up many related docs, but shared conversations and anonymization rules need product decisions.

### Missing Features

- Profile privacy controls.
- Block/report user.
- User suspension and moderation state.
- Verified coach badge.
- Coach availability and booking calendar.
- Profile preview before publishing.
- Photo moderation.
- Profile change history/admin audit.

## 3. Discovery

### Implemented Features

- Nearby player discovery.
- Skill, distance, age, gender, availability, and activity-aware matching logic.
- Nearby active players on home/dashboard.
- Player directory.
- Player detail/profile modal.
- Coach directory.
- Coach profile pages.
- Courts directory with map and booking links.
- Court search/filtering by postcode and name.
- Event discovery/listing.
- Dismissed players per user.
- Court click tracking.
- Coach viewer and contact tracking.

### Partially Implemented Features

- Discovery ranking exists but is largely client-side and duplicated across match/home surfaces.
- Court data is read-only seed/admin data with no product admin UI.
- Coach discovery has analytics but no monetised ranking/featured placement.
- Directory and match discovery overlap, but are separate experiences.

### Missing Features

- Search by player name.
- Saved/favourite players.
- Saved/favourite courts.
- Club discovery.
- Coach/service filters such as price, lesson type, availability, certifications.
- Discovery recommendations explainability.
- Public shareable profile pages.
- SEO-facing public discovery pages.

## 4. Matchmaking

### Implemented Features

- Post match availability.
- Browse availability/open matches.
- Send match requests.
- Accept match requests.
- Decline/delete match requests.
- Pending, incoming, outgoing, accepted, and history match views.
- Match request notifications.
- Nearby availability notifications.
- Pending match nudges.
- Player relationship records connecting match interactions.
- Rematch flows through invite/messaging helpers.
- Court suggestions around match acceptance/invites.

### Partially Implemented Features

- Match request lifecycle is implemented in several places, with duplicated accept/delete/start logic.
- Player relationship tracking exists, but counters and deeper relationship stats are explicitly deferred.
- `match_requests`, `match_invites`, `match_history`, `completed_matches`, and `match_scores` overlap as lifecycle records.
- Match route `app/matches/[id]/page.tsx` is a prototype/null page that listens to `match_events` but renders no UI.

### Missing Features

- Single canonical match lifecycle service.
- Reschedule flow for accepted matches.
- Cancellation reason.
- No-show/dispute flow.
- Match confirmation from both players before completion.
- Availability expiry UI/control.
- Doubles/team matchmaking.
- Match preference presets.
- Anti-spam/rate limiting for challenges.

## 5. Messaging

### Implemented Features

- Conversation list.
- One-to-one conversation pages.
- Message send/read/unread handling.
- Typing state.
- Conversation last read metadata.
- Direct message notifications.
- Group/event conversation support through conversation context.
- Structured match invite messages.
- Invite status mirroring between message and `match_invites`.
- Message notification state collection for throttling push/email.

### Partially Implemented Features

- Messaging is functional but heavily concentrated in a very large route file.
- Event chat exists both as `events/{eventId}/chat` and event/group conversation patterns.
- Group messaging notification support exists, but UI exposure appears focused on event-related contexts.
- Web push fallback is marked TODO in functions.

### Missing Features

- Message reactions.
- Attachments/photos.
- Message delete/edit.
- User blocking/reporting from chat.
- Spam controls.
- Search conversations.
- Archived conversations.
- Rich system messages for all match lifecycle changes.

## 6. Scheduling

### Implemented Features

- Calendar page.
- Calendar entries for accepted match invites.
- Calendar entries for event attendance.
- Cloud Function calendar sync for event creation, participant changes, and accepted invites.
- Invite detail page from calendar.
- Event detail page from calendar.
- Event reminders.
- Post-match reminders based on invite timing.
- Scheduled cleanup of expired events.

### Partially Implemented Features

- Calendar entries are derived data, with both client and function sync paths.
- Invite calendar sync is tied to message updates and repair logic.
- Event calendar sync exists, but recurring events are not modeled.

### Missing Features

- External calendar export/sync.
- Timezone UI.
- Reschedule requests.
- Availability calendar.
- Recurring events.
- Push/email reminder preferences.
- Court booking reservation confirmation.
- Conflict detection.

## 7. Match Play

### Implemented Features

- Match start/check-in entry points.
- Match completion details flow.
- Score entry with sets and winner.
- Match summary page.
- Match history page.
- Post-match feedback form.
- Completed match marker documents.
- Structured match score documents.
- Match history snapshots.
- Badges awarded for first completed match and first win through server/client flows.

### Partially Implemented Features

- Completion can be triggered through multiple paths, including summary, details, and check-in overlay.
- `match_history`, `match_scores`, and `completed_matches` duplicate parts of the same concept.
- `match_events` functions exist, but the app does not clearly create or expose match event timelines.
- Feedback exists but is not deeply used for recommendations, trust, or moderation.

### Missing Features

- Live scoring.
- Score confirmation by opponent.
- Dispute/correction flow.
- Retire/walkover handling.
- Match stats beyond sets/winner.
- Head-to-head page.
- Performance trends.
- Match photos/notes.

## 8. Social Features

### Implemented Features

- Events.
- Event join requests.
- Event host approval/decline.
- Event participants.
- Event chat.
- Event cancellation notifications.
- Coach/player discovery as social surfaces.
- Referral promo UI and legal terms.
- Invite/share referral links.
- Player relationship records for pairwise interaction history.

### Partially Implemented Features

- Referral stats are read in UI but no complete creation/qualification path is exposed.
- Referral Cloud Function exists in a separate file but is not exported from main functions index.
- Player relationship records currently store latest references, not rich social history.
- Event chat is lightweight and not integrated as a full social feed.

### Missing Features

- Friends/following.
- Clubs/groups.
- Activity feed.
- Public event sharing.
- Likes/comments.
- Contact import.
- Social graph recommendations.
- Referral fraud review.

## 9. Retention Features

### Implemented Features

- Native push notifications.
- In-app notification bell.
- Email reminders for events/messages.
- Pending match request nudges.
- Event reminders.
- Post-match reminders.
- Badges.
- Nearby active players.
- Match history.
- Calendar.
- Rematch/invite helpers.
- Last active tracking.

### Partially Implemented Features

- Push and email throttling exists for messages, but broader notification preference management is limited.
- Badges are basic and not yet a broader achievement system.
- Rematch flows exist, but no dedicated retention dashboard or habit loop.
- Referral promotion is currently campaign-specific and dated.

### Missing Features

- Weekly digest.
- Personalized reactivation campaigns.
- Streaks.
- Goals.
- Saved opponents.
- Recommended next match.
- Lapsed-user winback flow.
- Notification preference center.

## 10. Notifications

### Implemented Features

- In-app notifications collection.
- Notification bell UI.
- Desktop sidebar notification handling.
- Native Android/iOS push token registration.
- Web/device token capture.
- Message push/email notifications.
- Match request notifications.
- Match invite notifications.
- Event join request notifications.
- Event accepted/cancelled notifications.
- Event reminders.
- Post-match reminders.
- Mail queue integration for Firebase email extension.
- Message notification state to suppress noisy duplicate alerts.

### Partially Implemented Features

- `device_tokens` is inconsistently keyed by UID or raw token.
- Native push is primary; web push fallback is explicitly marked TODO.
- Notification documents are created by both client code and functions, with some dedupe logic.
- User-level notification preferences are not productized.

### Missing Features

- Full notification settings page.
- Quiet hours.
- Per-channel opt-in/out.
- Notification center filtering.
- Delivery logs/admin view.
- Push permission education flow beyond prompt.
- Badge count sync.

## 11. Gamification

### Implemented Features

- Badge catalog.
- Badge artwork assets.
- First match badge.
- First match complete badge.
- First win badge.
- MVP badge placeholder.
- Profile badge display.
- Some automatic badge awarding after match lifecycle events.

### Partially Implemented Features

- Badge awarding is split between client and Cloud Functions.
- MVP badge exists visually but no real awarding criteria was found.
- Badge system has no levels, progress, or collection page beyond profile display cues.

### Missing Features

- Achievement rules engine.
- Badge progress tracking.
- Leaderboards.
- Challenges.
- Streaks.
- Seasonal competitions.
- Rewards tied to referrals/events/match completion.
- Anti-gaming controls.

## 12. Administration

### Implemented Features

- Firestore rules.
- Firestore indexes.
- Firebase Functions for notifications, reminders, cleanup, stats, account deletion, coach deletion, calendar sync, and public stats.
- Data import/backfill scripts.
- Postcode import script.
- Court migration/import scripts.
- Relationship backfill scripts.
- Public stats backfill scripts.
- Orphaned conversation cleanup script.
- Firebase document map/reference docs.
- Firebase email extension config files.

### Partially Implemented Features

- Administration is script-based, not UI-based.
- Coach analytics are collected but not exposed in an admin/coach dashboard.
- Support feedback collection is written by UI but lacks a matching Firestore rule.
- Data Connect schema/query files exist but are not visibly integrated with the app.
- `courtsuggestions` package exists separately and appears not integrated with main UI.

### Missing Features

- Admin dashboard.
- User search.
- User moderation/suspension.
- Coach approval.
- Event moderation.
- Court CRUD.
- Support inbox.
- Referral management.
- Notification delivery dashboard.
- Revenue dashboard.
- Data quality dashboard.
- Audit logs.

## Firestore Features Not Exposed Or Weakly Exposed In UI

- `player_relationships`: relationship docs are created/backfilled and used in some relationship summary contexts, but there is no full user-facing relationship/history product.
- `message_notification_state`: used internally for throttling; not exposed to users/admin.
- `event_reminder_sends`: internal send log; not exposed.
- `mail`: email extension queue; not exposed.
- `device_tokens`: debug/raw token collection; not exposed.
- `users/{uid}/devices`: push devices are registered, but no device management UI exists.
- `coach_contact_events`: lead/contact events are tracked, but no coach/admin analytics UI was found.
- `coaches/{coachId}/viewers`: coach profile viewers are tracked, but no visible coach analytics dashboard was found.
- `coaches/{coachId}/uniqueClicks`: daily unique coach click markers are tracked, but not exposed.
- `court_clicks`: court map/booking click analytics are tracked, but not exposed.
- `support_feedback`: support submissions exist in UI, but no admin support inbox is exposed.
- `waitlist_users`: waitlist capture exists, but no admin waitlist UI is exposed.
- `referral_stats`: read by referral widgets, but no complete creation/admin flow was found.
- `match_events`: Cloud Functions and a prototype match route reference it, but no clear user-facing match timeline UI or creation flow was found.
- `booking`: Firestore rules mention `booking`, but no implemented UI write path was found.
- `player_public_stats`: computed by functions and partially surfaced, but there is no dedicated stats product/dashboard.

