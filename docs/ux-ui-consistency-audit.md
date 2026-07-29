# TennisMate application-wide UX/UI consistency audit

**Audit date:** 28 July 2026  
**Audit scope:** All visual routes under `app/`, their mobile and desktop implementations, shared navigation, dialogs, overlays, bottom sheets, forms, loading/empty/error states, and responsive behavior.  
**Deliverable status:** Audit only. No application code was changed.

## How to use this document

Each finding has a stable backlog ID, user impact, source evidence, a specific fix, and acceptance criteria. Fix Critical items before release, schedule High items into the next implementation cycle, and address Medium/Low items as part of the design-system consolidation.

This was a source-based audit of 39 visual routes and their shared components. Authenticated and data-dependent states could not be safely reproduced without test credentials and seeded test data, so no runtime screenshots are included. Exact component and line references are provided instead. Before closing the backlog, validate the fixes at 320, 375, 768, 1024, 1280, and 1440 px; with keyboard-only navigation; at 200% browser zoom; with VoiceOver/TalkBack; with reduced motion; and with loading, empty, permission-denied, offline, and server-error fixtures.

## Severity model

| Severity | Meaning |
|---|---|
| Critical | Can block a core journey, duplicate or corrupt application chrome, or prevent an accessibility user from operating the product. |
| High | Materially degrades a core journey, causes major cross-device inconsistency, or creates a broad WCAG/usability failure. |
| Medium | Noticeable friction, inconsistency, or maintainability debt with a clear user-facing consequence. |
| Low | Polish, wording, metadata, or cleanup that should follow the systemic work. |

## Executive summary

| Severity | Count |
|---|---:|
| Critical | 2 |
| High | 16 |
| Medium | 18 |
| Low | 10 |
| **Total** | **46** |

The strongest current patterns are in onboarding v2 and the activity leaderboard: they use meaningful headings, minimum touch sizes, live regions, retry states, focus movement, and reduced-motion handling. The weakest area is architectural consistency. Calendar mounts the global shell twice; mobile and desktop expose different primary destinations; events are highlighted as Calendar or Home; two signup experiences coexist; and dozens of overlays implement their own interaction and accessibility behavior.

The recommended implementation direction is to establish one application shell, one navigation model, and shared primitives for dialogs, sheets, tabs, buttons, fields, and asynchronous states. Repairing individual screens without those primitives will reproduce the same drift.

---

## Critical

### C-01 — Calendar mounts the complete application shell twice

**Area:** Navigation, responsive layout, loading, notifications, PWA  
**Evidence:** The root already wraps every route in `ClientLayoutWrapper` at `app/layout.tsx:39-40`; the mobile Calendar branch mounts another wrapper at `app/calendar/page.tsx:308-516`.

**Why it matters:** On mobile Calendar this can render two bottom navigation bars and duplicate `BackButtonHandler`, push/service-worker initialization, profile prompts, PWA prompts, auth/profile listeners, and shell loading gates. It can also produce competing fixed layers and duplicate event handlers.

**Recommended fix:** Remove the route-level wrapper. Make the root shell the sole owner of global chrome and expose route configuration through a central route policy or layout segment.

**Acceptance criteria:** Calendar mounts one footer, one PWA prompt, one feedback action, and one native back listener; navigating to and from Calendar does not add duplicate fixed UI or subscriptions.

### C-02 — Browser zoom is explicitly disabled

**Area:** Accessibility, responsive layout  
**Evidence:** `maximumScale: 1` in `app/layout.tsx:13-18`.

**Why it matters:** Users with low vision cannot pinch-zoom or reliably reach 200% magnification. This is an application-wide accessibility blocker and conflicts with WCAG 1.4.4 expectations.

**Recommended fix:** Remove `maximumScale` and test every core flow at 200% and 400% zoom/reflow. Fix overflow instead of restricting magnification.

**Acceptance criteria:** Pinch zoom works on mobile web; no core content or action is clipped at 200% zoom; layouts reflow without two-dimensional scrolling except genuine data tables.

---

## High

### H-01 — Primary navigation omits core destinations and changes meaning by viewport

**Area:** Navigation consistency, unnecessary taps  
**Evidence:** Mobile footer exposes only Home, Chat, Directory, and Profile at `components/ClientLayoutWrapper.tsx:825-891`. Desktop exposes Home, Chat, Calendar, Search, and Profile at `components/desktop_layout/TMDesktopSidebar.tsx:386-398`. Match Me, My Matches, Events, Courts, Coaches, and Leaderboard are absent. A computed flow-aware `footerTabs` model exists but is unused at `components/ClientLayoutWrapper.tsx:296-309`.

**Why it matters:** Core match tasks require a detour through Home, desktop and mobile users learn different information architectures, and returning users cannot predict where features live.

**Recommended fix:** Define one product-level navigation taxonomy. Put the highest-frequency destinations in both mobile and desktop navigation, move secondary destinations into a clearly labelled More menu, and validate with usage data.

**Acceptance criteria:** Every core destination is reachable in one tap/click from the shell or one predictable More menu; labels and ordering are consistent across mobile, desktop, PWA, iOS, and Android.

### H-02 — Desktop active navigation is absent or misleading

**Area:** Navigation consistency, orientation  
**Evidence:** Match routes deliberately return no active item at `components/desktop_layout/TMDesktopSidebar.tsx:400-429`. Events list/details pass `active="Calendar"` at `components/events/DesktopEventsPage.tsx:158` and `components/events/DesktopEventDetailsPage.tsx:282`; event creation passes `active="Home"` at `components/events/DesktopCreateEventPage.tsx:417`; Courts passes `active="Search"` at `components/desktop_layout/DesktopCourtsDirectory.tsx:79`.

**Why it matters:** The shell tells users they are somewhere other than their current feature, weakening orientation and making backtracking harder.

**Recommended fix:** Derive active state from a central route-to-navigation map. Add first-class destinations or a parent grouping with visible sub-navigation rather than borrowing unrelated labels.

**Acceptance criteria:** Every protected route has exactly one accurate current destination; parent/child relationships are visually explicit.

### H-03 — Navigation has no programmatic current-page state

**Area:** Accessibility, navigation  
**Evidence:** Active styling is visual only in `components/ClientLayoutWrapper.tsx:833-885` and `components/desktop_layout/TMDesktopSidebar.tsx:617-637`; there is no `aria-current` in the application source.

**Why it matters:** Screen-reader users are not told which destination is current, and active state cannot be reliably interpreted without color.

**Recommended fix:** Set `aria-current="page"` on the active link and use a non-color indicator. For grouped destinations, expose the parent and selected child clearly.

**Acceptance criteria:** A screen reader announces the current destination once; active state remains identifiable in forced-colors and monochrome modes.

### H-04 — Signup has two visually and behaviorally different experiences, but login still routes to the legacy form

**Area:** Onboarding, visual consistency, flow  
**Evidence:** Login constructs `/signup` links at `app/login/LoginClient.tsx:214-215,355-362` and passes the same link to desktop at `app/login/LoginClient.tsx:218-232`. The guided flow lives at `/signup-v2` (`lib/onboardingV2.ts:5`) and uses a different shell and field system (`components/onboarding-v2/OnboardingV2Shell.tsx:31-93`). Authenticated redirect protection recognizes `/signup` but not `/signup-v2` at `components/AuthGate.tsx:64-68`.

**Why it matters:** New users receive the older dense form instead of the newer guided experience; completed users can revisit onboarding v2; analytics and recovery behavior can diverge between entry points.

**Recommended fix:** Select one canonical signup route. Redirect the legacy route while preserving `next`, email, referral, and recovery parameters. Guard the canonical route based on lifecycle state.

**Acceptance criteria:** Every “Sign Up” entry opens the same flow; refresh, sign-in recovery, verification, referral, unsupported postcode, and already-complete account paths resolve consistently.

### H-05 — Most dialogs, lightboxes, and bottom sheets are not accessible dialogs

**Area:** Dialogs, bottom sheets, accessibility  
**Evidence:** More than 30 fixed overlays are implemented independently. Representative gaps include `components/AgeGateModal.tsx:61`, `components/calendar/DesktopCalendarView.tsx:370`, `components/DirectoryPage.tsx:376,594`, `components/matches/MatchCheckInOverlay.tsx:326`, `app/messages/MatchHubChat.tsx:4001,4589,4692,5130,5160`, `app/profile/ProfileContent.tsx:1610`, `app/signup/page.tsx:788,852`, and `components/SignupErrorModal.tsx:13`. The onboarding photo cropper demonstrates the desired baseline—dialog role, label, focus trap, Escape, and focus restoration—at `components/onboarding-v2/OnboardingProfilePhotoStep.tsx:55-104,206-207`.

**Why it matters:** Keyboard focus can remain behind an overlay, tab into obscured controls, fail to return to the trigger, or leave screen-reader users unaware that context changed.

**Recommended fix:** Build shared `Dialog`, `AlertDialog`, `BottomSheet`, and `Lightbox` primitives with labelled semantics, focus trap/restoration, Escape and backdrop policy, scroll lock, safe-area padding, and destructive-action variants. Migrate every overlay.

**Acceptance criteria:** Every modal/sheet has an accessible name, correct modality, trapped focus where modal, deterministic initial focus, Escape behavior, restored trigger focus, background isolation, and no scroll bleed.

### H-06 — Form labels and validation messages are frequently unassociated with their controls

**Area:** Forms, accessibility, error states  
**Evidence:** Separate labels lack `htmlFor`/matching `id` in Login (`app/login/LoginClient.tsx:284-317`, `components/signIn/DesktopSignIn.tsx:91-123`), legacy Signup (`app/signup/page.tsx:512-714`), Event creation (`app/events/new/page.tsx:534-640`), Coach profile (`app/coach/profile/page.tsx:710-784`), Profile edit (`app/profile/ProfileContent.tsx:1354-1511`), Courts filters (`app/courts/page.tsx:496-534`), Support (`app/support/page.tsx:163-190`), and Match forms (`app/match/MatchClient.tsx:3457-3564,4086-4193`). Many field errors are visual paragraphs without `aria-describedby` or focus movement.

**Why it matters:** Label clicks do not focus controls; assistive technology may announce fields without names; users are not taken to or told about invalid fields after submit.

**Recommended fix:** Create a shared field primitive that requires `id`, label, hint, and error wiring. On failed submit, focus an error summary or the first invalid field; set `aria-invalid` and `aria-describedby`.

**Acceptance criteria:** Every control has a computed accessible name; every error is programmatically linked and announced; the first invalid field is reachable without searching.

### H-07 — Mobile login uses neon green text on a white card

**Area:** Colours, accessibility  
**Evidence:** “Forgot Password?” and “Sign Up” use `text-[#39FF14]` inside the light login card at `app/login/LoginClient.tsx:331-360`.

**Why it matters:** Neon green against white has extremely weak visual contrast, making two essential account-recovery actions difficult to perceive.

**Recommended fix:** Use forest/emerald text on light surfaces and reserve neon for filled accents with dark foreground. Add automated contrast checks for text, icons, focus rings, and disabled states.

**Acceptance criteria:** Normal text meets 4.5:1, large text and essential UI graphics meet 3:1, and links remain distinguishable without hover.

### H-08 — Broken character encoding is visible in production-facing copy

**Area:** Wording, trust, typography  
**Evidence:** User-facing strings contain mojibake in Match Me (`app/match/MatchClient.tsx:2524,3297,3879-3882,4630,4653,4694`), Calendar (`app/calendar/page.tsx:406-427`), Login (`app/login/LoginClient.tsx:352`; `components/signIn/DesktopSignIn.tsx:119,162`), Signup (`app/signup/page.tsx:580-592,657,690,706,856-858`), verification (`app/verify-email/page.tsx:118,137-139`), and 404 (`app/not-found.tsx:7`).

**Why it matters:** Users see corrupted punctuation and icons in account creation, verification, matchmaking, errors, and navigation copy. This damages comprehension and trust.

**Recommended fix:** Normalize affected files to UTF-8, replace corrupted literals, add a CI scan for common mojibake sequences, and use icon components rather than encoded emoji for status.

**Acceptance criteria:** No rendered string contains `â`, `Â`, `Ã`, replacement characters, or corrupted emoji; CI fails if those patterns reappear in UI source.

### H-09 — Loading can produce blank screens and multiple sequential gates

**Area:** Loading states, perceived performance  
**Evidence:** Route-level Suspense fallbacks are `null` for Home, Match Me, Matches, Messages, Profile, Login, Leaderboard, and Signup v2 (`app/home/page.tsx:7`, `app/match/page.tsx:7`, `app/matches/page.tsx:7`, `app/messages/page.tsx:7`, `app/profile/page.tsx:7`, `app/login/page.tsx:7`, `app/activity-leaderboard/page.tsx:10`, `app/signup-v2/page.tsx:13`). Messages renders nothing until its media query runs at `app/messages/layout.tsx:11-24`; Verify Email renders nothing until ready at `app/verify-email/page.tsx:116`. AuthGate shows a plain loader (`components/AuthGate.tsx:73-78`) before the shell applies its own boot/profile gates (`components/ClientLayoutWrapper.tsx:686-752`).

**Why it matters:** Users can see white flashes, interpret the app as frozen, and wait through serial loading experiences that shift layout.

**Recommended fix:** Use route-specific skeletons inside a shared state framework; combine auth, boot, and profile readiness into one deterministic gate; reserve layout dimensions; announce meaningful long-running status.

**Acceptance criteria:** No visual route renders a blank fallback; only one full-page gate appears per navigation; skeletons match final layout; waits over one second expose an accessible status.

### H-10 — A fixed boot delay and bouncing splash add avoidable wait and motion

**Area:** Loading, animation, accessibility  
**Evidence:** The shell holds all routes until `bootDone` and renders an `animate-bounce` logo at `components/ClientLayoutWrapper.tsx:686-694`; reduced-motion handling exists only for onboarding in `app/globals.css:57-61`.

**Why it matters:** Fast devices are deliberately delayed, repeat visits feel slower, and motion-sensitive users cannot suppress the prominent bounce.

**Recommended fix:** Gate on actual readiness, enforce only a short minimum display time when native splash continuity requires it, and apply a global reduced-motion policy.

**Acceptance criteria:** Warm navigation is not delayed by a timer; the splash never loops; `prefers-reduced-motion: reduce` removes nonessential transforms and pulsing/bouncing.

### H-11 — Native `alert()` and `confirm()` are used throughout core flows

**Area:** Error states, button styles, interaction flow  
**Evidence:** Blocking browser dialogs appear in Events (`app/events/new/page.tsx:208-373`, `app/events/[id]/page.tsx:586-746`), Match Me (`app/match/MatchClient.tsx:1737,2319,2524,2579`), Matches (`app/matches/MatchesPageClient.tsx:1310-1495`), Chat (`app/messages/MatchHubChat.tsx:2147,3281`; `app/messages/MessagesClient.tsx:410-424`), score entry/feedback (`components/matches/MatchCheckInOverlay.tsx:248-305`; `app/matches/[id]/complete/details/page.tsx:283-293`; `app/matches/[id]/feedback/page.tsx:213`), coaches, and profile deletion.

**Why it matters:** Browser-native dialogs are visually inconsistent, block the main thread, provide poor contextual recovery, and behave differently in webviews and browsers.

**Recommended fix:** Replace confirmations with the shared `AlertDialog`; use inline field errors for validation and nonblocking banners/toasts for recoverable operation failures. Never tell users to “check console”.

**Acceptance criteria:** No user journey invokes browser `alert`/`confirm`; destructive dialogs name the object and consequence; errors preserve input and offer an actionable retry.

### H-12 — Desktop Match and Matches grids are not adaptive at the lower desktop breakpoint

**Area:** Responsiveness, spacing, hierarchy  
**Evidence:** Match Me uses a fixed 340 px filter column at `components/match/DesktopMatchPage.tsx:334-335` while recommendation cards force three columns until 2XL at `components/match/DesktopMatchPage.tsx:568`. My Matches similarly forces three columns at `components/matches/DesktopMatches.tsx:1907,2038`, alongside a 300 px shell sidebar (`components/desktop_layout/TMDesktopSidebar.tsx:472-474`).

**Why it matters:** At 1024–1279 px cards become cramped, text/actions wrap unpredictably, and the “desktop” layout can be less readable than mobile.

**Recommended fix:** Use container queries or `repeat(auto-fit,minmax(...))`; reduce to one/two columns based on available content width; collapse filters into a drawer before cards fall below their minimum width.

**Acceptance criteria:** No card truncates essential content or overlaps actions from 1024 px upward; grid column count responds to the main content container, not only viewport width.

### H-13 — Crop dialogs can overflow narrow and short viewports

**Area:** Responsive dialogs, accessibility  
**Evidence:** Mobile Profile and legacy Signup use fixed 340 px panels and 300 px croppers without viewport maximums or overflow handling (`app/profile/ProfileContent.tsx:1610-1642`; `app/signup/page.tsx:788-818`). Desktop Profile edit fixes the dialog at 420×360 px (`app/profile/DesktopProfileEditPage.tsx:936-969`).

**Why it matters:** On 320 px devices, zoomed pages, landscape phones, or an open keyboard, controls can be clipped and impossible to reach.

**Recommended fix:** Migrate to the shared responsive dialog; use `w-[calc(100%-2rem)] max-w-*`, `max-h-[calc(100dvh-2rem)]`, a scrollable content region, and a crop canvas sized from available space.

**Acceptance criteria:** Crop, cancel, zoom, and confirm remain visible/reachable at 320×568, mobile landscape, and 200% zoom.

### H-14 — Fixed prompts compete with the bottom navigation and each other

**Area:** Responsive layout, visual hierarchy, unnecessary obstruction  
**Evidence:** The mobile footer is fixed at `components/ClientLayoutWrapper.tsx:825-891`; the feedback action is independently fixed at `components/ClientLayoutWrapper.tsx:670-680,897`; the PWA prompt anchors to the viewport bottom at `components/pwa/PwaInstallPrompt.tsx:111-149`. These elements do not share a stacking/offset coordinator.

**Why it matters:** Prompts can cover bottom navigation, composer controls, or page actions. Multiple high-z-index elements compete for attention and reduce usable screen space.

**Recommended fix:** Create a shell-owned overlay dock that accounts for safe area, navigation height, keyboard, and mutual exclusivity. Make feedback a navigation/menu item or a smaller contextual action.

**Acceptance criteria:** Only one nonessential prompt is visible at a time; no prompt obscures navigation, chat composer, or primary actions on any supported viewport.

### H-15 — Tab and segmented controls expose no tab semantics or selected state

**Area:** Accessibility, interaction  
**Evidence:** Mobile My Matches tabs are styled buttons at `app/matches/MatchesPageClient.tsx:2344-2386`; desktop tabs at `components/matches/DesktopMatches.tsx:1823-1892`; chat hub tabs at `app/messages/MatchHubChat.tsx:4237-4263`; Match Me surface switch at `components/match/DesktopMatchPage.tsx:385-417`. None exposes a tablist/tab relationship or `aria-pressed`/`aria-selected`.

**Why it matters:** Assistive technology cannot determine which view is selected, and keyboard behavior does not match a tab interface.

**Recommended fix:** Use one tabs/segmented-control primitive. Implement `tablist`/`tab`/`tabpanel` with roving focus when content panels are tabs, or `aria-pressed` for independent view filters.

**Acceptance criteria:** Selected state is announced, arrow keys work for tabs, focus does not jump unexpectedly, and state is identifiable without color.

### H-16 — Async failures are often converted into empty states or console-only errors

**Area:** Error states, trust  
**Evidence:** Notification subscription failure clears the collection and shows “No notifications” (`components/notifications/NotificationBell.tsx:138-156,447`). Coach Directory has an error panel without retry (`app/coaches/page.tsx:409-430`). Several operations display “Check console for details” (`app/events/[id]/page.tsx:720,746`; `components/events/DesktopCreateEventPage.tsx:406`). Empty states frequently offer no recovery action (`components/events/DesktopEventsPage.tsx:203-206`; `app/events/page.tsx:267-271`; `components/DirectoryPage.tsx:468-476`).

**Why it matters:** Users cannot distinguish “nothing here” from “we failed to load it,” and have no safe recovery path.

**Recommended fix:** Standardize loading/empty/error/offline/permission-denied states. Preserve the last successful data where possible and provide Retry, reset-filter, create, or support actions appropriate to the state.

**Acceptance criteria:** Forced network and permission failures never render as legitimate emptiness; every recoverable error has a working retry; diagnostics are logged without being required of the user.

---

## Medium

### M-01 — No shared design-token system governs the UI

**Area:** Colours, spacing, typography, radius, shadows  
**Evidence:** `app/globals.css:3-15` defines only foreground/background and safe-area variables. The source contains at least 127 literal `#39FF14` uses, 125 `#0B3D2E` uses, 360 `rounded-full`, 343 `rounded-2xl`, 221 `rounded-xl`, 94 `rounded-3xl`, and hundreds of arbitrary 10–13 px text sizes.

**Why it matters:** Similar elements look different, design changes require broad search-and-replace, and contrast/focus behavior cannot be governed centrally.

**Recommended fix:** Define semantic tokens for surfaces, text, border, brand, success/warning/error, focus, spacing, typography, radius, elevation, and motion. Map Tailwind utilities/components to those tokens.

**Acceptance criteria:** New feature code uses semantic tokens; core primitives have documented variants; hard-coded brand colors are limited to the token layer.

### M-02 — Button styles and interaction states are fragmented

**Area:** Buttons, visual hierarchy  
**Evidence:** Buttons are authored inline across routes; separate constants exist in `app/matches/MatchesPageClient.tsx:93-100`, `app/matches/MatchesClient.tsx:77-84`, and onboarding (`components/onboarding-v2/OnboardingV2Flow.tsx:96-103`). Primary actions alternate among neon, forest, `green-600`, `emerald-700`, and blue (for example the legacy waitlist modal at `app/signup/page.tsx:860-865`).

**Why it matters:** Users cannot consistently infer primary, secondary, destructive, or disabled actions.

**Recommended fix:** Create shared Button/IconButton variants with consistent height, radius, focus, hover, active, busy, disabled, destructive, and full-width behavior.

**Acceptance criteria:** The same action hierarchy renders identically across screens; busy buttons retain their width and expose status; icon buttons have names and minimum target size.

### M-03 — Many buttons omit an explicit `type`

**Area:** Interaction reliability, forms  
**Evidence:** Representative cases include `components/AgeGateModal.tsx:90-108`, `components/ClientLayoutWrapper.tsx:674-679`, `components/EventChat.tsx:123`, `components/InviteWidget.tsx:91-94`, and numerous event/profile controls.

**Why it matters:** A button moved into or rendered within a form defaults to submit, causing accidental submissions and regressions.

**Recommended fix:** Require `type="button"` for non-submit actions through the shared Button API and linting.

**Acceptance criteria:** All native buttons declare a type; CI rejects untyped buttons.

### M-04 — Several icon controls are below the recommended touch target

**Area:** Accessibility, touch  
**Evidence:** Calendar month buttons are 36×36 px at `app/calendar/page.tsx:337-355`; Coach Directory back buttons are 36×36 px at `app/coaches/page.tsx:380-386,415-421,440-446`; password toggles use a small padded icon at `app/login/LoginClient.tsx:318-327`.

**Why it matters:** Small targets are harder for users with motor impairments and increase accidental taps.

**Recommended fix:** Standardize interactive targets at a minimum 44×44 CSS px while allowing the visual icon to remain 16–20 px.

**Acceptance criteria:** All tap targets meet 44×44 px or have equivalent spacing without overlap.

### M-05 — Calendar is visually interactive but lacks calendar semantics

**Area:** Accessibility, date interaction  
**Evidence:** Weekdays are ambiguous single letters at `app/calendar/page.tsx:358-364`; day buttons announce only “Select day 12,” lack month/year and selected/today state, and use no grid semantics at `app/calendar/page.tsx:367-400`.

**Why it matters:** Repeated “S” and “T” labels and context-free dates are difficult for screen-reader users; current selection is conveyed primarily by color.

**Recommended fix:** Use an accessible calendar grid pattern, full hidden weekday names, full date labels, `aria-selected`/`aria-current="date"`, and keyboard arrow navigation.

**Acceptance criteria:** Users can traverse dates with arrow keys and hear full date, event availability, today, and selected state.

### M-06 — Major screens use styled `div`s instead of a consistent heading hierarchy

**Area:** Typography, accessibility, hierarchy  
**Evidence:** Mobile Calendar title is a `div` (`app/calendar/page.tsx:327`); mobile My Matches title is a `div` (`app/matches/MatchesPageClient.tsx:2337-2340`); desktop Match Me title is a `div` (`components/match/DesktopMatchPage.tsx:340-343`). Other screens correctly use `h1`, such as Directory (`components/DirectoryPage.tsx:412-414`) and desktop Calendar (`components/calendar/DesktopCalendarView.tsx:83`).

**Why it matters:** Screen-reader heading navigation is inconsistent and page hierarchy depends on appearance alone.

**Recommended fix:** Require one descriptive `h1` per screen and logical nested headings in cards/sections; preserve visual styling independently.

**Acceptance criteria:** Every route has one useful page heading in the rendered tree; heading levels do not skip for visual reasons.

### M-07 — There is no skip link for the repeated desktop shell

**Area:** Keyboard accessibility, navigation  
**Evidence:** Desktop pages render `TMDesktopSidebar` before their main content, for example `components/events/DesktopEventsPage.tsx:156-163` and `components/matches/DesktopMatches.tsx:1742-1748`; neither the root shell nor sidebar provides a skip-to-content link.

**Why it matters:** Keyboard users must traverse the entire sidebar on every route change.

**Recommended fix:** Add a first-focusable “Skip to main content” link and a stable main-content target owned by the shell.

**Acceptance criteria:** The first Tab reveals the skip link; activating it moves focus to the page heading/main region.

### M-08 — Back behavior and fallback destinations vary by screen

**Area:** Navigation flow  
**Evidence:** Calendar falls back to `/` at `app/calendar/page.tsx:316-319`; invites fall back to a conversation or Messages at `app/invites/[inviteId]/page.tsx:433-445`; several screens call `router.back()` with no fallback (`app/coaches/page.tsx:380-446`; `app/matches/MatchesPageClient.tsx:2328-2334`). Native back returns to Home and does nothing on Home at `components/BackButtonHandler.tsx:32-49`.

**Why it matters:** Deep links and cold launches can leave users on an unexpected page, a blank history action, or unable to exit the Android app from Home.

**Recommended fix:** Define route-aware back policy: history when valid, otherwise the feature parent; on Android Home, use the agreed exit/minimize convention.

**Acceptance criteria:** Every detail/form screen has a deterministic fallback; `/` redirect is not used as a UI hop; Android back behavior matches platform expectations.

### M-09 — Responsive rendering is driven by multiple independent JavaScript media-query implementations

**Area:** Responsiveness, loading  
**Evidence:** Screens use shared `useIsDesktop`, local `matchMedia`, and direct `innerWidth` checks across Login (`app/login/LoginClient.tsx:23-34`), Messages (`app/messages/layout.tsx:11-24`), Coaches (`app/coaches/page.tsx:71-91`), Courts (`app/courts/page.tsx:173-175`), Match/Matches, PWA prompt, and Chat.

**Why it matters:** Initial mobile markup can flash before desktop replacement, 1024 px behavior can differ by component, and nested components may disagree about viewport mode.

**Recommended fix:** Centralize viewport/platform state in the shell, prefer CSS for layout changes, and use client branching only when behavior truly differs.

**Acceptance criteria:** No desktop/mobile flash at hydration; all components use documented breakpoints; resizing across a breakpoint preserves state and focus.

### M-10 — Safe-area and viewport-unit handling is inconsistent

**Area:** iOS/PWA responsiveness  
**Evidence:** Root uses `100dvh` (`app/layout.tsx:37`) but shell gates use `h-screen` (`components/ClientLayoutWrapper.tsx:690,724,745`). Many pages use `min-h-screen`; only some fixed controls use safe-area helpers. The PWA prompt accounts for the device inset but not the footer height (`components/pwa/PwaInstallPrompt.tsx:111`).

**Why it matters:** Browser chrome and keyboards can clip full-screen states; notched devices receive inconsistent top/bottom padding.

**Recommended fix:** Establish shell layout variables for dynamic viewport, header/footer height, keyboard, and safe-area insets. Avoid `100vh`/`h-screen` for interactive full-screen mobile layouts.

**Acceptance criteria:** No clipped content on iOS Safari/PWA portrait or landscape; keyboard opening keeps the focused field and primary action visible.

### M-11 — Motion preferences are handled only in onboarding

**Area:** Animation, accessibility  
**Evidence:** The only explicit reduced-motion rule is `app/globals.css:57-61`, while the app uses at least 45 pulsing skeletons, hover transforms, transitions, and a bouncing shell logo (`components/ClientLayoutWrapper.tsx:691`).

**Why it matters:** Motion-sensitive users receive animation throughout the app despite their OS preference.

**Recommended fix:** Add global reduced-motion defaults and primitive-level alternatives; keep necessary progress indication without translation or repeated pulsing.

**Acceptance criteria:** Reduced-motion mode eliminates nonessential movement and preserves understandable loading feedback.

### M-12 — Empty states are inconsistent and often dead ends

**Area:** Empty states, unnecessary taps  
**Evidence:** Leaderboard provides explanation and retry (`app/activity-leaderboard/ActivityLeaderboardClient.tsx:137`), and Calendar links to Events (`app/calendar/page.tsx:422-429`). In contrast, Events (`app/events/page.tsx:267-271`; `components/events/DesktopEventsPage.tsx:203-206`), Coaches (`app/coaches/page.tsx:486-493`), Directory (`components/DirectoryPage.tsx:468-476`), My Matches (`app/matches/MatchesPageClient.tsx:2445-2449`), and Match Me availability (`components/match/DesktopMatchPage.tsx:470-473`) frequently stop at plain text.

**Why it matters:** Users are told there is nothing to do but are not helped toward creating, broadening, resetting, or finding content.

**Recommended fix:** Define empty-state variants: first-use, no-filter-results, no-local-supply, and completed state. Give each one relevant next actions.

**Acceptance criteria:** Every empty state explains why it is empty and offers a valid next action or clearly states that no action is possible.

### M-13 — Status changes are rarely announced

**Area:** Accessibility, loading/error states  
**Evidence:** Live regions exist in a few newer screens (for example onboarding at `components/onboarding-v2/OnboardingV2Shell.tsx:86-87` and Match refresh at `components/match/DesktopMatchPage.tsx:380-383`) but not for most filtering, saving, invite, notification, and list refresh states.

**Why it matters:** Screen-reader users may activate a control and receive no indication that content loaded, failed, or changed.

**Recommended fix:** Add a shared status announcer and use polite/assertive levels deliberately; do not announce every skeleton/card.

**Acceptance criteria:** Submit, save, delete, refresh, filter-result count, and error outcomes are announced once with concise wording.

### M-14 — Notification behavior is duplicated between mobile and desktop

**Area:** Navigation, state consistency  
**Evidence:** Route resolution and Firebase subscriptions are separately implemented in `components/notifications/NotificationBell.tsx:123-160,227-307` and `components/desktop_layout/TMDesktopSidebar.tsx:276-329`. Mobile queries unread-only; desktop fetches read and unread and filters/counts afterward.

**Why it matters:** Destination rules, dropdown history, counts, error behavior, and future notification types can drift by viewport.

**Recommended fix:** Extract one notification data hook and one route resolver; let presentation differ without changing semantics.

**Acceptance criteria:** The same account sees the same unread count and routes on both viewports; new notification types require one routing change.

### M-15 — The 404 page offers no recovery action and inherits inappropriate shell behavior

**Area:** Error state, navigation  
**Evidence:** `app/not-found.tsx:3-9` contains only a heading and corrupted sentence, with no Home/back/search action.

**Why it matters:** Users arriving via an old notification or deep link reach a dead end.

**Recommended fix:** Add a branded not-found state with Home, Back, and optionally support/search. Decide explicitly whether authenticated chrome should remain.

**Acceptance criteria:** A user can recover in one action; the message contains no encoding errors and has correct page semantics.

### M-16 — Search and filter controls have inconsistent semantics and recovery

**Area:** Forms, interaction flow  
**Evidence:** Directory supplies an `aria-label` and two-character hint (`components/DirectoryPage.tsx:425-445`), while Coach search has placeholder-only naming (`app/coaches/page.tsx:390-399,451-459`), Courts search is placeholder-only (`app/courts/page.tsx:466-476`), and desktop Matches search is placeholder-only (`components/matches/DesktopMatches.tsx:1797-1804`). Filter tabs/chips generally expose selection by color only.

**Why it matters:** Placeholder text disappears while typing; assistive technology receives inconsistent names; users lack consistent clear/reset controls.

**Recommended fix:** Standardize a SearchField with persistent label, clear action, result count, loading state, and keyboard behavior; standardize FilterChip selected semantics and “Reset all.”

**Acceptance criteria:** Every search is named, clearable, and announces results; every selected filter is programmatically identifiable and resettable.

### M-17 — Raw image handling and alternative text are inconsistent

**Area:** Images, loading, accessibility  
**Evidence:** Many screens use raw `<img>` while others use `next/image`, including Calendar (`app/calendar/page.tsx:499`), Events (`app/events/page.tsx:322,338`; `app/events/[id]/page.tsx:882,1151`), Chat (`app/messages/MatchHubChat.tsx:3901,4333,4393`), Profile (`app/profile/ProfileContent.tsx:987`), and Matches. Chat images use generic alt text such as “avatar” and “me” (`app/messages/MatchHubChat.tsx:3901,4333,4393`).

**Why it matters:** Layout shift, loading strategy, fallback behavior, and screen-reader output differ by screen.

**Recommended fix:** Create Avatar and Media primitives with dimensions, fallback, error handling, loading policy, and contextual or decorative alternative text.

**Acceptance criteria:** Avatars never shift layout; failed images show a consistent fallback; repetitive/decorative images are hidden and meaningful images use the person/object name.

### M-18 — Desktop and mobile feature implementations duplicate large amounts of UI logic

**Area:** Consistency, maintainability  
**Evidence:** Separate implementations exist for Directory, Events, Calendar, Coaches, Match Me, My Matches, Profile, and Login—for example `components/DirectoryPage.tsx` vs `components/directory/DesktopDirectoryPage.tsx`, `app/matches/MatchesPageClient.tsx` vs `components/matches/DesktopMatches.tsx`, and `app/login/LoginClient.tsx` vs `components/signIn/DesktopSignIn.tsx`.

**Why it matters:** Copy, controls, states, accessibility, and feature availability diverge. Existing examples include different loading/empty treatments, form labels, and navigation active states.

**Recommended fix:** Share domain state and reusable presentation components; use responsive composition rather than full page forks wherever possible. Add parity tests for controls and states that must exist on both.

**Acceptance criteria:** Core actions, state labels, errors, and accessibility names have one source of truth across mobile and desktop.

---

## Low

### L-01 — Product terminology changes between navigation and screens

**Area:** Wording  
**Evidence:** Shell uses “Chat” and “Directory” (`components/ClientLayoutWrapper.tsx:843-872`), desktop uses “Chat” and “Search” (`components/desktop_layout/TMDesktopSidebar.tsx:390-397`), while screen headings use “Messages” and “Players” (`app/messages/MessagesClient.tsx:481,643`; `components/DirectoryPage.tsx:412-414`). “Find a Match,” “Match Me,” and “My Matches” also overlap.

**Why it matters:** Users must translate between labels to know whether destinations are the same.

**Recommended fix:** Approve a product vocabulary and apply it to navigation, headings, buttons, empty states, analytics labels, and support copy.

### L-02 — Capitalization and microcopy voice are inconsistent

**Area:** Wording, typography  
**Evidence:** “Welcome Back,” “Sign In,” “Create Account,” “Find a Match,” and sentence-case actions are mixed across Login, Signup, Match, Events, and Profile. Some errors expose implementation language such as “missing recipient id” (`app/match/MatchClient.tsx:2319`) or “Check console” (`app/events/[id]/page.tsx:720,746`).

**Recommended fix:** Use sentence case and user-language error guidelines; reserve technical identifiers for logs.

### L-03 — Global browser/PWA chrome uses an off-brand blue

**Area:** Colours  
**Evidence:** Theme color is `#2563eb` at `app/layout.tsx:29`, while primary brand colors throughout the UI are forest `#0B3D2E` and neon `#39FF14`.

**Recommended fix:** Set the theme/status-bar color through the brand token and validate light/dark platform behavior.

### L-04 — Font tokens reference fonts that are not loaded by the root layout

**Area:** Typography  
**Evidence:** `app/globals.css:31-32` maps sans/mono to Geist CSS variables, but `app/layout.tsx` does not initialize or apply a Next font.

**Why it matters:** Typography can fall back differently across platforms, changing line breaks and perceived hierarchy.

**Recommended fix:** Load the approved font once in the root or remove the unresolved variables and define an explicit system stack.

### L-05 — Feedback button has two competing implementations

**Area:** Components, colours, buttons  
**Evidence:** A green inner implementation is defined and rendered at `components/ClientLayoutWrapper.tsx:670-680,897`; a separate blue implementation exists at `components/FloatingFeedbackButton.tsx:10-23`.

**Recommended fix:** Keep one shared component and one route visibility policy.

### L-06 — Legacy shell/navigation components remain in the codebase

**Area:** Consistency, maintenance  
**Evidence:** `components/LayoutWrapper.tsx`, `components/AuthLayoutWrapper.tsx`, and `components/EventFooterNav.tsx` define alternate chrome; `EventFooterNav` has no usage and links Home to `/` at `components/EventFooterNav.tsx:22-35`.

**Recommended fix:** Remove unused shells after confirming no dynamic imports, or clearly document and test their ownership.

### L-07 — Icon systems and status symbols are mixed

**Area:** Iconography  
**Evidence:** The app mixes Lucide, React Icons (for example `GiTennisCourt` at `app/courts/page.tsx:436`), text initials (`TM` at `components/desktop_layout/TMDesktopSidebar.tsx:479-488`), encoded emoji, and raw check/cross glyphs (`app/signup/page.tsx:580-592`).

**Recommended fix:** Define an icon set, sizes, stroke weight, filled/outline rules, and status-icon mapping; use text only where it communicates additional meaning.

### L-08 — Notification dropdowns do not expose expanded/menu state

**Area:** Accessibility  
**Evidence:** Desktop bell has an accessible name but no `aria-expanded`/`aria-controls` at `components/desktop_layout/TMDesktopSidebar.tsx:493-523`; the dropdown is a generic fixed `div`.

**Recommended fix:** Use the shared popover/menu pattern with trigger state, labelled region, focus entry, Escape, outside-click, and return focus.

### L-09 — Generic route metadata does not identify the current screen

**Area:** Navigation, accessibility  
**Evidence:** Root metadata always uses “TennisMate” at `app/layout.tsx:8-11`; most route files define no screen-specific metadata.

**Why it matters:** Browser history, tabs, bookmarks, and screen-reader page-change cues are less informative.

**Recommended fix:** Add route titles such as “My Matches · TennisMate” and meaningful descriptions for public pages.

### L-10 — Horizontal carousels hide scrollbars without a consistent affordance

**Area:** Interaction, responsiveness  
**Evidence:** The global helper hides WebKit scrollbars at `app/globals.css:43-45`; mobile activity/event cards use snap carousels and large minimum widths (for example `components/home/UpcomingEventsSection.tsx:84-97` and `app/home/HomeClient.tsx:1691-1732`).

**Why it matters:** Users may not discover additional cards, especially with mouse/keyboard or when the next card is not visibly peeking.

**Recommended fix:** Preserve an edge preview, add previous/next controls on non-touch layouts, support arrow-key scrolling, and label the region.

---

## Screen and flow coverage matrix

The matrix maps every visual route to the most relevant findings. Shared findings such as C-02, H-05, H-06, H-09, M-01, and M-02 apply broadly even when not repeated in each row.

| Route / screen | Implementations and states reviewed | Backlog references |
|---|---|---|
| `/` | Auth redirect and loading | H-09, M-08, L-09 |
| `/login` | Mobile/desktop form, password reveal, recovery/signup links, error/loading | H-04, H-06, H-07, H-08, H-09, M-04, M-18 |
| `/forgot-password` | Form, success/error, background layout | H-06, M-02, M-10 |
| `/signup` | Legacy form, validation, cropper, waitlist dialog, legal links | H-04, H-05, H-06, H-08, H-13, M-02 |
| `/signup-v2` | All guided steps, progress, verification, photo crop, ready/waitlist | H-04, H-09, M-11, M-18 |
| `/verify-email` | Initial readiness, resend/check states, logout | H-08, H-09, M-03, M-10, M-13 |
| `/verify-complete`, `/verified` | Completion route and route-handler screen | H-08, M-02, L-09 |
| `/waitlist` | Unsupported-region outcome and sign-out | H-04, M-03, L-09 |
| `/home` | Mobile/desktop dashboard, match/event cards, overlays, activity | H-05, H-09, H-14, M-12, M-18, L-10 |
| `/match` | Mobile/desktop recommendations, distance/club/activity filters, availability, overlays, errors | H-01, H-02, H-05, H-08, H-09, H-12, H-15, H-16, M-13, M-16, M-18 |
| `/matches` | Mobile/desktop tabs, pending/confirmed/history, check-in, deletion, profile/invite overlays | H-01, H-02, H-05, H-09, H-11, H-12, H-15, H-16, M-12, M-18 |
| `/matches/[id]` | Match detail client handoff | H-05, H-09, M-08 |
| `/matches/history/[id]` | History detail, loading/not-found, rematch | H-08, H-11, M-08, M-12 |
| `/matches/[id]/complete` | Completion handoff | H-09, M-06 |
| `/matches/[id]/complete/details` | Score form, validation, summary, loading | H-06, H-08, H-11, M-02, M-03 |
| `/matches/[id]/feedback` | Ratings, radio groups, validation, notes | H-06, H-11, M-02, M-13 |
| `/matches/[id]/summary` | Result state, mobile cards, responsive table | H-08, M-02, M-17 |
| `/messages` | Mobile/desktop inbox, search, loading/empty, delete | H-05, H-09, H-11, M-09, M-12, M-14, M-16, M-18 |
| `/messages/[conversationID]` | iOS/mobile chat, desktop embedded chat, tabs, composer, action sheet, match/event/profile overlays | H-05, H-11, H-14, H-15, M-09, M-10, M-13, M-17 |
| `/directory` | Mobile/desktop search, loading/empty, player profile/invite overlays | H-05, H-16, M-12, M-16, M-18 |
| `/players/[id]` | Public player profile, invite states, club/history summary | H-05, H-06, H-16, M-17 |
| `/calendar` | Mobile calendar and desktop calendar/detail overlay | C-01, H-02, H-05, H-08, H-09, M-04, M-05, M-06, M-08, M-18 |
| `/events` | Mobile filters/list and desktop cards, loading/empty/create CTA | H-02, H-15, H-16, M-12, M-18 |
| `/events/new` | Mobile create/edit and desktop create, place lookup, dirty-state confirm, validation | H-02, H-06, H-11, H-16, M-02, M-03, M-18 |
| `/events/[id]` | Mobile/desktop details, host/member actions, chat, participants, profile overlay | H-02, H-05, H-11, H-16, M-08, M-17, M-18 |
| `/invites/[inviteId]` | Loading/not-found/cancelled, invite detail, score and profile overlays | H-05, H-08, H-09, M-08, M-12, M-17 |
| `/courts` | Mobile/desktop search, state/distance filters, load/error/empty | H-02, H-06, H-16, M-03, M-04, M-12, M-16, M-18 |
| `/coaches` | Mobile/desktop directory, region gate, search, load/error/empty, phone action | H-02, H-06, H-08, H-11, H-16, M-04, M-12, M-16, M-18 |
| `/coaches/[id]` | Mobile/desktop profile, contact actions, gallery/lightbox | H-05, H-11, M-04, M-17, M-18 |
| `/coach/profile`, `/coach/profile/edit` | Create/edit/publish, gallery/avatar crop, deletion, validation | H-05, H-06, H-11, H-13, M-02, M-17 |
| `/clubs/[id]` | Mobile/desktop profile, member cards, membership prompts/selectors, loading/error | H-05, H-06, H-16, M-12, M-17 |
| `/clubs/[id]/members` | Mobile/desktop member directory and skeleton/empty state | H-09, H-16, M-12, M-18 |
| `/profile` | Mobile/desktop view/edit, status, photos, visibility, danger zone | H-05, H-06, H-11, H-13, M-13, M-17, M-18 |
| `/activity-leaderboard` | Period control, skeleton, empty/error/retry, ranking cards | H-09, H-15, M-02, M-11, M-13 |
| `/support` | Feedback form, validation, success/error | H-06, M-02, M-13 |
| `/privacy`, `/terms` | Long-form legal layout and table of contents | C-02, M-06, L-09 |
| `/legal/referral-competition-terms` | Referral legal terms | C-02, L-09 |
| Not found | 404 copy and recovery | H-08, M-15, L-09 |

## Shared component and overlay coverage

| Component family | Reviewed examples | Main findings |
|---|---|---|
| Application shell | `AuthGate`, `ClientLayoutWrapper`, `TMDesktopSidebar`, `BackButtonHandler`, safe-area helpers | C-01, C-02, H-01–H-03, H-09–H-10, H-14, M-07–M-10 |
| Notifications/prompts | `NotificationBell`, desktop notification dropdown, `NotificationPrompt`, `PwaInstallPrompt`, profile prompt, feedback FAB | H-05, H-14, H-16, M-13–M-14, L-05, L-08 |
| Dialogs/sheets/lightboxes | Age gate, player/profile overlays, invite overlays, check-in, filters, crop dialogs, chat action sheet, referral modal | H-05, H-11, H-13 |
| Forms | Login/signup, onboarding, profile/coach, Match availability/filters, event create, score/feedback, support, club membership | H-06, H-11, M-02–M-04, M-13, M-16 |
| Cards/lists | Player, match, event, court, coach, club member, leaderboard, notification, relationship summary | H-12, H-16, M-01–M-02, M-12, M-17, L-10 |
| Responsive variants | Mobile/desktop Home, Login, Directory, Calendar, Events, Coaches, Courts, Match, Matches, Messages, Profile, Clubs | H-12–H-14, M-09–M-10, M-18 |

## Recommended implementation sequence

1. **Release safety:** C-01, C-02, H-07, H-08.
2. **Architecture:** H-01–H-04, M-07–M-09, M-14, M-18.
3. **Accessible primitives:** H-05–H-06, H-15, M-02–M-06, M-13, M-16–M-17, L-08.
4. **State system:** H-09–H-11, H-16, M-12.
5. **Responsive and overlay system:** H-12–H-14, M-10–M-11, L-10.
6. **Visual language and cleanup:** M-01, L-01–L-07, L-09.

## Definition of done for the audit backlog

- One global shell owns navigation, platform listeners, safe areas, PWA prompts, and feedback.
- Mobile and desktop share the same information architecture and terminology.
- Every route has a meaningful page title and `h1`; current navigation is announced.
- Every form control is labelled; validation and async outcomes are linked and announced.
- Every dialog/sheet uses a tested primitive with focus, keyboard, scroll, and safe-area behavior.
- Every data view has distinct loading, empty, error, offline, and permission-denied handling.
- No user-facing mojibake, native alerts/confirms, blank route fallbacks, or console-directed errors remain.
- Core flows pass keyboard, screen reader, reduced-motion, forced-colors, 200% zoom, and target-size checks.
- Visual regression coverage includes the documented viewport matrix and both empty/error fixtures.
- Mobile and desktop parity tests confirm that every core action and state exists in both variants.
