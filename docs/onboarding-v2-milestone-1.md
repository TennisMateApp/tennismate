# Onboarding 2.0 — Milestone 1 local preview

The milestone is isolated at `/signup-v2`. The existing `/signup` route is unchanged and remains the production signup journey.

## Enable the route

- `npm run dev`: the route is enabled automatically.
- Vercel Preview: set `ONBOARDING_V2_ENABLED=true` for the Preview environment only.
- Local production-mode testing: set `ONBOARDING_V2_ENABLED=true` before `npm run build` and `npm start`.

The route always redirects to `/signup` when `VERCEL_ENV=production`, even if the preview flag is accidentally present. The final milestone screen is explicitly labelled as a development preview and does not link to Home or Match Me.

## Manual test entry

Open `http://localhost:3000/signup-v2`. Referral and destination candidates can be exercised with:

`http://localhost:3000/signup-v2?ref=TESTCODE&next=%2Fhome`

Use Firebase Auth and Functions emulators where available, or a non-production Firebase project. This milestone invokes the frozen `initializeOnboardingAccount` callable after Auth creation and sends Firebase verification email using `/verify-complete` as the canonical action handler.

## Milestone boundary

The preview stops after account creation and verification. It does not collect or complete postcode, skill, availability, club membership, or profile photo, and it does not set `profileComplete` or `isMatchable`.

